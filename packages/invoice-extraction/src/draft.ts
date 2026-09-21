import { createInvoiceDraft } from '@app/invoice-core'
import type { DraftField, InvoiceDraft } from '@app/invoice-core'
import type {
  ExtractedAmount,
  ExtractedValue,
  ExtractionRunResult,
  InvoiceExtractionCandidates,
} from './contracts'

function field<T>(item?: ExtractedValue<T>): DraftField<T> {
  return item
    ? {
        value: item.value,
        extractedValue: item.value,
        originalExtractedValue: item.value,
        extractionMethod: 'deterministic',
        confidence: item.certainty,
        status: item.certainty === 'high' ? 'extracted' : 'uncertain',
        source: {
          page: item.page,
          sourceText: item.sourceText,
          sourceItemIds: item.sourceItemIds,
          ...(item.boundingBox ? { boundingBox: item.boundingBox } : {}),
          ...(item.label ? { label: item.label } : {}),
        },
      }
    : { status: 'missing' }
}

function amountField(
  candidates: Array<ExtractedValue<ExtractedAmount>>,
): DraftField<number> {
  const [selected, ...alternatives] = candidates
  if (!selected) return { status: 'missing' }
  const result = field({ ...selected, value: selected.value.minor })
  result.alternatives = alternatives.map((item) => ({
    value: item.value.minor,
    label: [item.label, item.sourceText].filter(Boolean).join(' · '),
    source: {
      page: item.page,
      sourceText: item.sourceText,
      sourceItemIds: item.sourceItemIds,
      ...(item.boundingBox ? { boundingBox: item.boundingBox } : {}),
      ...(item.label ? { label: item.label } : {}),
    },
  }))
  return result
}

function applyAddress(
  target: InvoiceDraft['seller'] | InvoiceDraft['buyer'],
  block?: ExtractedValue<Array<string>>,
) {
  if (!block) return
  const [name, ...address] = block.value
  const postalIndex = address.findIndex((line) => /\b\d{4,6}\b/.test(line))
  const street = address.slice(0, postalIndex < 0 ? -1 : postalIndex).join(', ')
  const cityLine = postalIndex < 0 ? address.at(-1) : address[postalIndex]
  if (name) target.name = field({ ...block, value: name })
  if (street) target.street = field({ ...block, value: street })
  const city = cityLine?.match(/(\d{4,5})\s+(.+)/)
  if (city?.[1] && city[2]) {
    target.postalCode = field({ ...block, value: city[1] })
    target.city = field({ ...block, value: city[2] })
    if (/^\d{5}$/.test(city[1]))
      target.countryCode = field({ ...block, value: 'DE' })
  }
}

/** Maps configured extraction evidence into an intentionally incomplete review draft. */
export function mapExtractionResultToDraft(
  result: ExtractionRunResult | InvoiceExtractionCandidates,
  previous?: InvoiceDraft,
): InvoiceDraft {
  const candidates = 'candidates' in result ? result.candidates : result
  const draft = createInvoiceDraft()
  draft.number = field(candidates.invoiceNumbers[0])
  draft.issueDate = field(candidates.dates[0])
  draft.deliveryDate = field(candidates.deliveryDates[0])
  draft.dueDate = field(candidates.dueDates[0])
  draft.currency = field(candidates.currencies[0])
  draft.netTotalMinor = amountField(candidates.netTotals)
  draft.taxTotalMinor = amountField(candidates.taxTotals)
  draft.grossTotalMinor = amountField(candidates.grossTotals)
  draft.payment.iban = field(candidates.ibans[0])
  draft.payment.terms = field(candidates.paymentTerms[0])
  draft.seller.vatId = field(candidates.vatIds[0])
  applyAddress(draft.seller, candidates.sellerBlocks[0])
  applyAddress(draft.buyer, candidates.buyerBlocks[0])
  draft.lines = candidates.lines.map((line) => ({
    description: field({ ...line, value: line.value.description }),
    quantity: field(
      line.value.quantity === undefined
        ? undefined
        : { ...line, value: line.value.quantity },
    ),
    unitCode: { value: 'C62', status: 'missing' },
    unitPriceMinor: field(
      line.value.unitPriceMinor === undefined
        ? undefined
        : { ...line, value: line.value.unitPriceMinor },
    ),
    netAmountMinor: field(
      line.value.netAmountMinor === undefined
        ? undefined
        : { ...line, value: line.value.netAmountMinor },
    ),
    vatRateBasisPoints: field(
      line.value.vatRateBasisPoints !== undefined
        ? { ...line, value: line.value.vatRateBasisPoints }
        : candidates.taxRates.length === 1
          ? {
              ...candidates.taxRates[0]!,
              value: candidates.taxRates[0]!.value * 100,
            }
          : undefined,
    ),
  }))
  const rates = candidates.taxRates
  if (rates.length) {
    draft.vatBreakdown = rates.map((rate) => {
      const rateText = `${rate.value}`.replace('.', '[,.]')
      const tax = candidates.taxTotals.find((candidate) =>
        new RegExp(`${rateText}\\s*%`).test(
          candidate.label ?? candidate.sourceText,
        ),
      )
      const rateLines = candidates.lines.filter(
        (line) =>
          line.value.vatRateBasisPoints === Math.round(rate.value * 100),
      )
      const taxableAmount = rateLines.length
        ? rateLines.reduce(
            (sum, line) => sum + (line.value.netAmountMinor ?? 0),
            0,
          )
        : candidates.netTotals.length === 1 && rates.length === 1
          ? candidates.netTotals[0]!.value.minor
          : undefined
      return {
        rateBasisPoints: field({ ...rate, value: rate.value * 100 }),
        taxableAmountMinor:
          taxableAmount === undefined
            ? { status: 'missing' }
            : field({ ...rate, value: taxableAmount }),
        taxAmountMinor: tax
          ? field({ ...tax, value: tax.value.minor })
          : { status: 'missing' },
      }
    })
  }
  if (previous) {
    const preserveUserFields = (current: unknown, old: unknown): unknown => {
      if (
        !current ||
        !old ||
        typeof current !== 'object' ||
        typeof old !== 'object'
      )
        return current
      if (
        'status' in old &&
        ['user-edited', 'user-confirmed'].includes(String(old.status))
      )
        return old
      if ('status' in current || 'status' in old) return current
      if (Array.isArray(current) && Array.isArray(old)) {
        return current.map((item, index) =>
          old[index] === undefined
            ? item
            : preserveUserFields(item, old[index]),
        )
      }
      if (Array.isArray(current) || Array.isArray(old)) return current
      for (const key of Object.keys(current)) {
        if (key in old)
          (current as Record<string, unknown>)[key] = preserveUserFields(
            (current as Record<string, unknown>)[key],
            (old as Record<string, unknown>)[key],
          )
      }
      return current
    }
    return preserveUserFields(draft, previous) as InvoiceDraft
  }
  return draft
}

import { extractAddressBlocks } from './addresses'
import { createExtractionContext } from './context'
import type {
  DocumentModel,
  DocumentPage,
  DocumentTextItem,
} from '@app/pdf-core'
import type { ExtractionContext } from './context'
import type { ExtractedValue, InvoiceExtractionCandidates } from './contracts'

const labels = {
  invoiceNumbers:
    /\b(?:invoice\s*(?:no\.?|number)|rechnungs?(?:nummer|nr\.?)?)\b/i,
  dates: /\b(?:invoice\s*date|rechnungsdatum)\b/i,
  deliveryDates:
    /\b(?:delivery\s*date|leistungsdatum|lieferdatum|datum\s+der\s+leistung)\b/i,
  dueDates: /\b(?:due\s*date|zahlbar\s*(?:bis|am)|fällig(?:keitsdatum)?)\b/i,
  vatIds: /\b(?:vat\s*(?:id|no\.?)|ust\s*-?\s*id(?:nr\.?)?)\b/i,
  ibans: /\biban\b/i,
  netTotals: /\b(?:net\s*(?:total|amount)|netto(?:betrag|summe)?|summe)\b/i,
  taxTotals:
    /\b(?:vat\s*(?:total|amount)?|mehrwertsteuer|umsatzsteuer|mwst|ust(?:betrag)?)\b/i,
  grossTotals:
    /\b(?:grand\s*total|total\s*(?:due|amount)?|gesamt(?:betrag|summe)?|gesamt)\b/i,
  seller:
    /\b(?:seller|supplier|vendor|verkäufer|lieferant|rechnungssteller)\b/i,
  buyer: /\b(?:buyer|bill\s*to|customer|kunde|rechnungsempfänger)\b/i,
}

const currencies: Record<string, string> = {
  '€': 'EUR',
  EUR: 'EUR',
  USD: 'USD',
  $: 'USD',
  GBP: 'GBP',
  '£': 'GBP',
  CHF: 'CHF',
}
const ibanPattern = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi
const vatIdPattern = /\bDE\s?\d{9}\b/gi
const datePattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/g
const amountPattern =
  /(?<![\w./])(?:\d{1,3}(?:[.\s,]\d{3})+|\d+)(?:[,.]\d{2})?(?![.\d%])/g
const taxRatePattern = /\b(\d{1,2}(?:[.,]\d+)?)\s*%/g
const currencyPattern = /(?:\b(?:EUR|USD|GBP|CHF)\b|€|\$|£)/g

export function normalizeIban(value: string): string | null {
  const normalized = value.replace(/[ -]/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) return null
  const rearranged = `${normalized.slice(4)}${normalized.slice(0, 4)}`
  let remainder = 0
  for (const character of rearranged)
    for (const digit of /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character)
      remainder = (remainder * 10 + Number(digit)) % 97
  return remainder === 1 ? normalized : null
}
export function normalizeVatId(value: string): string | null {
  const normalized = value.replace(/\s/g, '').toUpperCase()
  vatIdPattern.lastIndex = 0
  return /^DE\d{9}$/.test(normalized) && vatIdPattern.test(normalized)
    ? normalized
    : null
}
export function parseDate(value: string): string | null {
  const [first, second, third] = value.split(/[./-]/)
  if (!first || !second || !third) return null
  const [year, month, day] =
    first.length === 4
      ? [Number(first), Number(second), Number(third)]
      : [Number(third), Number(second), Number(first)]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
    : null
}
export function parseAmount(value: string): number | null {
  const compact = value.replace(/\s/g, '')
  if (!/^\d+(?:[.,]\d+)*$/.test(compact)) return null
  const separators = [...compact.matchAll(/[.,]/g)]
  const lastSeparator = separators.at(-1)?.index ?? -1
  const fractionLength = compact.length - lastSeparator - 1
  if (lastSeparator >= 0 && fractionLength !== 2 && fractionLength !== 3)
    return null
  const hasDecimal = lastSeparator >= 0 && fractionLength === 2
  const whole = hasDecimal
    ? compact.slice(0, lastSeparator).replace(/[.,]/g, '')
    : compact.replace(/[.,]/g, '')
  const grouped = hasDecimal ? compact.slice(0, lastSeparator) : compact
  if (/[.,]/.test(grouped) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(grouped))
    return null
  const fraction = hasDecimal ? compact.slice(lastSeparator + 1) : ''
  const minor = Number(`${whole}${fraction.padEnd(2, '0')}`)
  return Number.isSafeInteger(minor) ? minor : null
}
export function parseTaxRate(value: string): number | null {
  const rate = Number(value.replace(',', '.').replace('%', '').trim())
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null
}
export function normalizeCurrency(value: string): string | null {
  return currencies[value.toUpperCase()] ?? null
}

function candidate<T>(
  value: T,
  page: DocumentPage,
  item: DocumentTextItem,
): ExtractedValue<T> {
  return {
    value,
    certainty: 'medium',
    page: page.number,
    sourceText: item.text,
    sourceItemIds: [item.id],
    ...(item.boundingBox ? { boundingBox: item.boundingBox } : {}),
  }
}
function labelled<T>(
  values: Array<ExtractedValue<T>>,
  pages: ReadonlyArray<DocumentPage>,
  pattern: RegExp,
): Array<ExtractedValue<T>> {
  return values
    .map((value) => {
      const valuePage = pages.find((page) => page.number === value.page)
      const inlineLabel = valuePage?.textItems.find(
        (item) => item.id === value.sourceItemIds[0] && pattern.test(item.text),
      )
      const nearby = valuePage?.textItems.flatMap((item) => {
        if (!pattern.test(item.text) || !item.boundingBox || !value.boundingBox)
          return []
        const verticalDistance = Math.abs(
          item.boundingBox.y - value.boundingBox.y,
        )
        const horizontalDistance = Math.max(
          0,
          item.boundingBox.x - (value.boundingBox.x + value.boundingBox.width),
          value.boundingBox.x - (item.boundingBox.x + item.boundingBox.width),
        )
        if (verticalDistance > 12 || horizontalDistance > 180) return []
        return [{ item, score: verticalDistance * 10 + horizontalDistance }]
      })
      const near = inlineLabel
        ? { item: inlineLabel, score: 0 }
        : nearby?.sort((a, b) => a.score - b.score)[0]
      const labelDistance = near?.score ?? Infinity
      return near
        ? {
            ...value,
            certainty: 'high' as const,
            label: near.item.text,
            labelDistance,
          }
        : value
    })
    .sort(
      (a, b) =>
        Number(b.certainty === 'high') - Number(a.certainty === 'high') ||
        (a.labelDistance ?? Infinity) - (b.labelDistance ?? Infinity),
    )
}
function extractValues<T>(
  pages: ReadonlyArray<DocumentPage>,
  pattern: RegExp,
  parse: (text: string, item: DocumentTextItem) => T | null,
) {
  return pages.flatMap((page) =>
    page.textItems.flatMap((item) => {
      pattern.lastIndex = 0
      return Array.from(item.text.matchAll(pattern)).flatMap((match) => {
        const value = parse(match[0], item)
        return value === null ? [] : [candidate(value, page, item)]
      })
    }),
  )
}
function unique<T>(items: Array<ExtractedValue<T>>) {
  const found = new Map<string, ExtractedValue<T>>()
  for (const item of items) {
    const key = JSON.stringify(item.value)
    if (!found.has(key) || item.certainty === 'high') found.set(key, item)
  }
  return [...found.values()]
}
function labelledText(
  pages: ReadonlyArray<DocumentPage>,
  pattern: RegExp,
): Array<ExtractedValue<string>> {
  return pages.flatMap((page) =>
    page.textItems.flatMap((item, index): Array<ExtractedValue<string>> => {
      if (!pattern.test(item.text)) return []
      const inlineText = item.text
        .replace(pattern, '')
        .replace(/^[\s:#.-]+/, '')
        .trim()
      const text = inlineText || page.textItems[index + 1]?.text.trim()
      return text
        ? [
            {
              ...candidate(text, page, item),
              certainty: 'high',
              label: item.text,
            },
          ]
        : []
    }),
  )
}
function labelledAmounts(pages: ReadonlyArray<DocumentPage>, pattern: RegExp) {
  return labelled(
    extractValues(pages, amountPattern, (text, item) => {
      const minor = parseAmount(text)
      if (minor === null) return null
      const currency = normalizeCurrency(
        item.text.match(currencyPattern)?.[0] ?? '',
      )
      return currency ? { minor, currency } : { minor }
    }),
    pages,
    pattern,
  ).filter(
    (amount) =>
      /[,.]\d{2}/.test(amount.sourceText) ||
      new RegExp(currencyPattern.source, 'i').test(amount.sourceText) ||
      amount.certainty === 'high',
  )
}
function invoiceNumbers(
  pages: ReadonlyArray<DocumentPage>,
  additionalPatterns: ReadonlyArray<string> = [],
) {
  const labelledNumbers = labelledText(pages, labels.invoiceNumbers).flatMap(
    (item) => {
      const match = item.value
        .replace(/^(?:Nr\.?|Nummer)\s*/i, '')
        .match(/^[\s:#.-]*([A-Z0-9][A-Z0-9/_-]{1,})/i)
      return match?.[1] ? [{ ...item, value: match[1] }] : []
    },
  )
  const customNumbers = additionalPatterns.flatMap((source) => {
    let pattern: RegExp
    try {
      pattern = new RegExp(source, 'giu')
    } catch {
      return []
    }
    return pages.flatMap((page) =>
      page.textItems.flatMap((item) => {
        pattern.lastIndex = 0
        return Array.from(item.text.matchAll(pattern)).flatMap((match) => {
          const value = (match[1] ?? match[0]).trim()
          return value
            ? [
                {
                  ...candidate(value, page, item),
                  certainty: 'high' as const,
                  label: source,
                },
              ]
            : []
        })
      }),
    )
  })
  return [...labelledNumbers, ...customNumbers]
}

export function extractDocumentCandidates(
  input: ExtractionContext | DocumentModel,
  options: { invoiceNumberPatterns?: ReadonlyArray<string> } = {},
): Omit<
  InvoiceExtractionCandidates,
  | 'lines'
  | 'paymentTerms'
  | 'amounts'
  | 'taxRates'
  | 'netTotals'
  | 'taxTotals'
  | 'grossTotals'
> {
  const context = 'document' in input ? input : createExtractionContext(input)
  const pages = context.pages
  const ibans = labelled(
    extractValues(pages, ibanPattern, normalizeIban),
    pages,
    labels.ibans,
  )
  const vatIds = labelled(
    extractValues(pages, vatIdPattern, normalizeVatId),
    pages,
    labels.vatIds,
  )
  const dates = labelled(
    extractValues(pages, datePattern, parseDate),
    pages,
    labels.dates,
  )
  const currenciesFound = extractValues(
    pages,
    currencyPattern,
    normalizeCurrency,
  )
  const parties = extractAddressBlocks(context)
  const relativeTerms = pages.flatMap((page) =>
    page.textItems.flatMap((item) => {
      const matches = [
        ...item.text.matchAll(/\binnerhalb\s+von\s+(\d{1,3})\s+Tagen\b/gi),
      ]
      return matches.flatMap((match) => {
        const days = Number(match[1])
        return days > 0 && days <= 365 ? [{ page, item, days }] : []
      })
    }),
  )
  const labelledIssueDates = labelled(
    extractValues(pages, datePattern, parseDate),
    pages,
    labels.dates,
  ).filter((date) => date.certainty === 'high')
  const labelledIssueDateValues = [
    ...new Set(labelledIssueDates.map((date) => date.value)),
  ]
  const documentDateValues = [
    ...new Set(
      extractValues(pages, datePattern, parseDate).map((date) => date.value),
    ),
  ]
  const issueDateValues =
    labelledIssueDateValues.length > 0
      ? labelledIssueDateValues
      : documentDateValues
  const explicitDueDates = labelled(
    extractValues(pages, datePattern, parseDate),
    pages,
    labels.dueDates,
  ).filter((date) => date.certainty === 'high')
  const relativeDueDate =
    relativeTerms.length === 1 &&
    explicitDueDates.length === 0 &&
    issueDateValues.length === 1 &&
    documentDateValues.length === 1 &&
    documentDateValues[0] === issueDateValues[0]
      ? (() => {
          const source = relativeTerms[0]!
          const [year, month, day] = issueDateValues[0]!.split('-').map(Number)
          const due = new Date(Date.UTC(year!, month! - 1, day! + source.days))
          const item = candidate(
            due.toISOString().slice(0, 10),
            source.page,
            source.item,
          )
          return {
            ...item,
            certainty: 'high' as const,
            label: source.item.text,
          }
        })()
      : undefined
  return {
    ibans: unique(ibans),
    vatIds: unique(vatIds),
    dates: unique(dates),
    deliveryDates: unique(
      labelled(
        extractValues(pages, datePattern, parseDate),
        pages,
        labels.deliveryDates,
      ),
    ),
    currencies: unique(currenciesFound),
    invoiceNumbers: unique(
      invoiceNumbers(pages, options.invoiceNumberPatterns),
    ),
    dueDates: unique([
      ...explicitDueDates,
      ...(relativeDueDate ? [relativeDueDate] : []),
    ]),
    sellerBlocks: unique(parties.seller),
    buyerBlocks: unique(parties.buyer),
  }
}

export function extractLabelledTotalCandidates(
  input: ExtractionContext | DocumentModel,
) {
  const context = 'document' in input ? input : createExtractionContext(input)
  const pages = context.pages
  const grossTotals = labelledAmounts(pages, labels.grossTotals).filter(
    (totalCandidate) =>
      !/\b(?:net|netto|vat|mwst|ust|mehrwertsteuer|umsatzsteuer)\b/i.test(
        totalCandidate.label ?? totalCandidate.sourceText,
      ),
  )
  return {
    amounts: unique(
      labelledAmounts(
        pages,
        /\b(?:total|gesamt|summe|netto|mehrwertsteuer|umsatzsteuer|mwst|ust)\b/i,
      ),
    ),
    netTotals: unique(labelledAmounts(pages, labels.netTotals)),
    grossTotals: unique(grossTotals),
  }
}

export function extractVatCandidates(input: ExtractionContext | DocumentModel) {
  const context = 'document' in input ? input : createExtractionContext(input)
  return {
    taxRates: unique(
      labelled(
        extractValues(context.pages, taxRatePattern, parseTaxRate),
        context.pages,
        labels.taxTotals,
      ),
    ),
    taxTotals: unique(labelledAmounts(context.pages, labels.taxTotals)),
  }
}

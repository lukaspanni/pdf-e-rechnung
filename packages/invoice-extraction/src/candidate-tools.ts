import type {
  ExtractedValue,
  ExtractionFieldGroup,
  InvoiceExtractionCandidates,
} from './contracts'

export function mergeEquivalentCandidates(
  field: ExtractionFieldGroup,
  candidates: ReadonlyArray<ExtractedValue<unknown>>,
  pluginId: string,
  priority?: ReadonlyArray<string>,
): Array<ExtractedValue<unknown>> {
  const merged: Array<ExtractedValue<unknown>> = []
  const rank = new Map(priority?.map((id, index) => [id, index]) ?? [])
  for (const candidate of candidates) {
    const evidence = {
      source: candidate.provenance?.source ?? 'pdf-text',
      pluginId: candidate.provenance?.pluginId ?? pluginId,
      ...(candidate.provenance?.description
        ? { description: candidate.provenance.description }
        : {}),
    } as const
    const index = merged.findIndex(
      (existing) =>
        JSON.stringify(existing.value) === JSON.stringify(candidate.value),
    )
    if (index < 0) {
      merged.push({
        ...candidate,
        provenance: candidate.provenance ?? evidence,
      })
      continue
    }

    const existing = merged[index]!
    const alternateEvidence = [
      ...(existing.alternateEvidence ?? []),
      existing.provenance ?? { source: 'pdf-text' as const, pluginId },
      ...(candidate.alternateEvidence ?? []),
      evidence,
    ].filter(
      (item, itemIndex, all) =>
        all.findIndex(
          (other) =>
            other.pluginId === item.pluginId && other.source === item.source,
        ) === itemIndex,
    )
    const preferred =
      (rank.get(candidate.provenance?.pluginId ?? '') ?? Infinity) <
        (rank.get(existing.provenance?.pluginId ?? '') ?? Infinity) ||
      ((rank.get(candidate.provenance?.pluginId ?? '') ?? Infinity) ===
        (rank.get(existing.provenance?.pluginId ?? '') ?? Infinity) &&
        ((field !== 'dates' &&
          candidate.certainty === 'high' &&
          existing.certainty !== 'high') ||
          (candidate.labelDistance ?? Infinity) <
            (existing.labelDistance ?? Infinity)))
        ? candidate
        : existing
    merged[index] = { ...preferred, alternateEvidence }
  }
  return merged
}

export function rankCandidates(
  candidates: ReadonlyArray<ExtractedValue<unknown>>,
  priority: ReadonlyArray<string> | undefined,
): Array<ExtractedValue<unknown>> {
  const rank = new Map(priority?.map((id, index) => [id, index]) ?? [])
  return [...candidates].sort(
    (a, b) =>
      (rank.get(a.provenance?.pluginId ?? '') ?? Infinity) -
        (rank.get(b.provenance?.pluginId ?? '') ?? Infinity) ||
      Number(b.certainty === 'high') - Number(a.certainty === 'high') ||
      (a.labelDistance ?? Infinity) - (b.labelDistance ?? Infinity),
  )
}

export function emptyInvoiceCandidates(): InvoiceExtractionCandidates {
  return {
    ibans: [],
    vatIds: [],
    dates: [],
    deliveryDates: [],
    amounts: [],
    taxRates: [],
    currencies: [],
    invoiceNumbers: [],
    dueDates: [],
    netTotals: [],
    taxTotals: [],
    grossTotals: [],
    paymentTerms: [],
    sellerBlocks: [],
    buyerBlocks: [],
    lines: [],
  }
}

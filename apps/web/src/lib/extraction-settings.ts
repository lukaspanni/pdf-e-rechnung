export type ExtractionSettings = {
  invoiceNumberPatterns: Array<string>
}

export const defaultExtractionSettings: ExtractionSettings = {
  invoiceNumberPatterns: [],
}

const storageKey = 'pdf-e-rechnung.settings.v1'

export function loadExtractionSettings(
  storage?: Pick<Storage, 'getItem'>,
): ExtractionSettings {
  try {
    const browserStorage =
      storage ??
      (typeof localStorage === 'undefined' ? undefined : localStorage)
    const stored = browserStorage?.getItem(storageKey)
    if (!stored) return { ...defaultExtractionSettings }
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object')
      return { ...defaultExtractionSettings }
    const patterns = (parsed as { invoiceNumberPatterns?: unknown })
      .invoiceNumberPatterns
    return {
      invoiceNumberPatterns: Array.isArray(patterns)
        ? patterns.filter(
            (pattern): pattern is string => typeof pattern === 'string',
          )
        : [],
    }
  } catch {
    return { ...defaultExtractionSettings }
  }
}

export function saveExtractionSettings(
  settings: ExtractionSettings,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const browserStorage =
      storage ??
      (typeof localStorage === 'undefined' ? undefined : localStorage)
    browserStorage?.setItem(storageKey, JSON.stringify(settings))
  } catch {
    // Extraction remains usable when browser storage is unavailable or full.
  }
}

export function validateInvoiceNumberPatterns(
  patterns: ReadonlyArray<string>,
): Array<string | null> {
  return patterns.map((pattern) => {
    if (!pattern.trim()) return null
    try {
      new RegExp(pattern, 'giu')
      return null
    } catch {
      return 'Ungültiger regulärer Ausdruck.'
    }
  })
}

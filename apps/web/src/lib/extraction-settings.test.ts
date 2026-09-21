import { describe, expect, it } from 'vitest'
import {
  loadExtractionSettings,
  saveExtractionSettings,
  validateInvoiceNumberPatterns,
} from './extraction-settings'

function storageStub(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
  }
}

function clearStoredSettings() {
  try {
    localStorage.removeItem('pdf-e-rechnung.settings.v1')
  } catch {
    // Some test runtimes do not expose browser storage.
  }
}

describe('extraction settings', () => {
  it('clears persisted patterns after the test', () => {
    clearStoredSettings()
  })

  it('loads and saves invoice number patterns', () => {
    const storage = storageStub()
    const settings = { invoiceNumberPatterns: ['\\bEW-\\d+\\b'] }

    saveExtractionSettings(settings, storage)

    expect(loadExtractionSettings(storage)).toEqual(settings)
  })

  it('falls back to defaults for malformed saved data', () => {
    expect(loadExtractionSettings(storageStub('{'))).toEqual({
      invoiceNumberPatterns: [],
    })
    expect(
      loadExtractionSettings(storageStub('{"invoiceNumberPatterns":4}')),
    ).toEqual({
      invoiceNumberPatterns: [],
    })
  })

  it('identifies invalid regex strings and accepts empty rows', () => {
    expect(validateInvoiceNumberPatterns(['\\bEW-\\d+\\b', '[', ''])).toEqual([
      null,
      'Ungültiger regulärer Ausdruck.',
      null,
    ])
  })
})

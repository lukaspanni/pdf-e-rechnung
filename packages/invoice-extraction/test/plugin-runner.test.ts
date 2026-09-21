import { describe, expect, it } from 'vitest'
import { createExtractionContext, runInvoiceExtraction } from '../src/index'
import type { DocumentModel } from '@app/pdf-core'

const document: DocumentModel = {
  sourcePdf: new Uint8Array([37, 80, 68, 70]),
  pages: [
    {
      number: 1,
      textItems: [
        {
          id: 'first',
          text: 'Invoice date',
          boundingBox: { x: 10, y: 100, width: 60, height: 12 },
        },
        {
          id: 'date',
          text: '22.09.2026 CUSTOM-42',
          boundingBox: { x: 90, y: 100, width: 60, height: 12 },
        },
      ],
    },
  ],
}

describe('typed built-in extraction pipeline', () => {
  it('shares source bytes and lazily reuses parsed text and layout', () => {
    const context = createExtractionContext(document)

    expect(context.sourcePdf).toBe(document.sourcePdf)
    expect(context.normalizedText).toBe('Invoice date 22.09.2026 CUSTOM-42')
    expect(context.lines).toBe(context.lines)
    expect(context.blocks).toBe(context.blocks)
    expect(context.itemsById.get('date')).toBe(document.pages[0]?.textItems[1])
    expect(context.itemsByNormalizedText.get('invoice date')).toEqual([
      document.pages[0]?.textItems[0],
    ])
  })

  it('runs built-in extractors with shared context', async () => {
    const context = createExtractionContext(document)
    const result = await runInvoiceExtraction(context, {
      invoiceNumberPatterns: ['(CUSTOM-\\d+)'],
    })

    expect(result.candidates.dates[0]?.value).toBe('2026-09-22')
    expect(result.candidates.invoiceNumbers[0]?.value).toBe('CUSTOM-42')
    expect(result.candidates.invoiceNumbers[0]?.provenance).toMatchObject({
      source: 'pdf-text',
      pluginId: 'document-fields',
    })
  })

  it('runs VAT and labelled-total plugins by default', async () => {
    const result = await runInvoiceExtraction({
      pages: [
        {
          number: 1,
          textItems: [
            { id: 'net', text: 'Net total 100,00 EUR' },
            { id: 'tax', text: 'VAT 19,00 EUR 19%' },
            { id: 'gross', text: 'Grand total 119,00 EUR' },
          ],
        },
      ],
    })

    expect(result.candidates.netTotals[0]?.value.minor).toBe(10000)
    expect(result.candidates.taxTotals[0]?.value.minor).toBe(1900)
    expect(result.candidates.grossTotals[0]?.value.minor).toBe(11900)
    expect(result.candidates.taxRates[0]?.value).toBe(19)
    expect(result.candidates.netTotals[0]?.provenance?.pluginId).toBe(
      'labelled-totals',
    )
    expect(result.candidates.taxRates[0]?.provenance?.pluginId).toBe('vat')
  })

  it('keeps candidates and selects the ranked leader in the returned draft', async () => {
    const result = await runInvoiceExtraction({
      pages: [
        {
          number: 1,
          textItems: [{ id: 'invoice', text: 'Invoice number: RE-42' }],
        },
      ],
    })
    expect(result.candidates.invoiceNumbers[0]?.value).toBe('RE-42')
    expect(result.draft?.number.value).toBe(
      result.candidates.invoiceNumbers[0]?.value,
    )
  })
})

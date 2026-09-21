import { describe, expect, it } from 'vitest'
import { runInvoiceExtraction } from '../src/index'
import type { DocumentModel } from '@app/pdf-core'

function model(
  items: Array<{ id: string; text: string; x?: number; y?: number }>,
): DocumentModel {
  return {
    pages: [
      {
        number: 1,
        textItems: items.map((item) => ({
          id: item.id,
          text: item.text,
          boundingBox: {
            x: item.x ?? 100,
            y: item.y ?? 100,
            width: 100,
            height: 12,
          },
        })),
      },
    ],
  }
}

describe('payment terms extraction', () => {
  it('extracts German payment terms from invoice prose split across lines', async () => {
    const document = model([
      { id: 'thanks', text: 'Vielen Dank für die Zusammenarbeit.' },
      {
        id: 'prose-one',
        text: 'Die Rechnungssumme überweisen Sie bitte',
        y: 86,
      },
      { id: 'prose-two', text: 'innerhalb von 14 Tagen ohne Abzug', y: 72 },
      { id: 'prose-three', text: 'auf mein unten genanntes Konto.', y: 58 },
    ])

    const result = await runInvoiceExtraction(document)

    expect(result.candidates.paymentTerms[0]).toMatchObject({
      value: 'innerhalb von 14 Tagen ohne Abzug',
      certainty: 'medium',
      page: 1,
      sourceText: expect.stringContaining('innerhalb von 14 Tagen ohne Abzug'),
      sourceItemIds: expect.arrayContaining(['prose-two']),
      provenance: { pluginId: 'payment-terms', source: 'pdf-text' },
    })
  })

  it('extracts English prose and labelled terms', async () => {
    const result = await runInvoiceExtraction(
      model([
        { id: 'english', text: 'Please pay within 30 days without deduction.' },
        { id: 'label', text: 'Payment terms: Net 14', y: 70 },
      ]),
    )

    expect(result.candidates.paymentTerms.map(({ value }) => value)).toEqual([
      'Net 14',
      'within 30 days without deduction',
    ])
    expect(result.candidates.paymentTerms[0]?.certainty).toBe('high')
  })

  it('includes prose payment terms in the configured extraction result', async () => {
    const result = await runInvoiceExtraction(
      model([{ id: 'terms', text: 'innerhalb von 14 Tagen ohne Abzug' }]),
    )

    expect(result.candidates.paymentTerms.map(({ value }) => value)).toEqual([
      'innerhalb von 14 Tagen ohne Abzug',
    ])
  })

  it('ignores prose that does not state a supported payment duration', async () => {
    const result = await runInvoiceExtraction(
      model([
        { id: 'terms', text: 'Bitte überweisen Sie den Rechnungsbetrag.' },
      ]),
    )

    expect(result.candidates.paymentTerms).toEqual([])
  })
})

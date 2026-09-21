import { describe, expect, it } from 'vitest'
import { editDraftField } from '@app/invoice-core'
import {
  createMockSemanticPlugin,
  createSemanticDocument,
  mapExtractionResultToDraft,
  mergeSemanticResult,
  runInvoiceExtraction,
  semanticExtractionResultSchema,
} from '../src/index.ts'
import type { DocumentModel } from '@app/pdf-core'

const box = (x: number, y: number) => ({ x, y, width: 20, height: 10 })
const doc: DocumentModel = {
  pages: [
    {
      number: 1,
      textItems: [
        {
          id: 'invoice-label-value',
          text: 'Rechnung #RE-42',
          boundingBox: box(10, 100),
        },
        {
          id: 'term',
          text: 'Zahlbar innerhalb von 14 Tagen',
          boundingBox: box(10, 80),
        },
        {
          id: 'reference',
          text: 'Referenz: CUST-55',
          boundingBox: box(10, 60),
        },
        { id: 'total-label', text: 'Gesamtbetrag', boundingBox: box(10, 40) },
      ],
    },
  ],
}

describe('semantic extraction boundary', () => {
  it('builds compact normalized input with labels and deterministic results', async () => {
    const deterministic = await runInvoiceExtraction(doc)
    const semantic = createSemanticDocument(doc, deterministic)
    const numberBlock = semantic.pages[0]!.textBlocks[0]!
    expect(numberBlock).toMatchObject({
      id: 'invoice-label-value',
      pageNumber: 1,
      detectedLabels: ['invoice-number'],
      boundingBox: { x: 0.3333333333333333, y: 0.9090909090909091 },
    })
    expect(semantic.deterministicExtraction.number.value).toBe('RE-42')
    expect(JSON.stringify(semantic)).not.toContain('sourcePdf')
  })

  it('validates semantic result shape and supported paths', () => {
    expect(() =>
      semanticExtractionResultSchema.parse({
        fields: [
          {
            path: 'number',
            value: 'R-1',
            confidence: 'high',
            sourceBlockIds: ['b1'],
          },
        ],
      }),
    ).not.toThrow()
    expect(() =>
      semanticExtractionResultSchema.parse({
        fields: [
          {
            path: 'not-a-field',
            value: 'R-1',
            confidence: 'high',
            sourceBlockIds: [],
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      semanticExtractionResultSchema.parse({
        fields: [
          {
            path: 'number',
            value: 'R-1',
            confidence: 'high',
            sourceBlockIds: [2],
          },
        ],
      }),
    ).toThrow()
  })

  it('rejects semantic values that cite unknown source blocks', async () => {
    const deterministic = await runInvoiceExtraction(doc)
    expect(() =>
      mergeSemanticResult(
        mapExtractionResultToDraft(deterministic),
        {
          fields: [
            {
              path: 'payment.terms',
              value: '30 days',
              confidence: 'high',
              sourceBlockIds: ['missing'],
            },
          ],
        },
        createSemanticDocument(doc, deterministic),
        doc,
      ),
    ).toThrow(/unknown source block/)
  })

  it('merges semantic values with provenance, but preserves high-confidence deterministic and user values', async () => {
    const deterministic = await runInvoiceExtraction(doc)
    const semanticDoc = createSemanticDocument(doc, deterministic)
    const draft = mapExtractionResultToDraft(deterministic)
    draft.number = {
      value: 'EDITED',
      extractedValue: 'RE-42',
      extractionMethod: 'user',
      originalExtractionMethod: 'deterministic',
      confidence: 'high',
      status: 'user-edited',
      source: {
        page: 1,
        sourceText: 'Rechnung #RE-42',
        sourceItemIds: ['invoice-label-value'],
      },
    }
    const merged = mergeSemanticResult(
      draft,
      {
        fields: [
          {
            path: 'number',
            value: 'SEM-42',
            confidence: 'high',
            sourceBlockIds: ['invoice-label-value'],
          },
          {
            path: 'payment.terms',
            value: '14 Tage netto',
            confidence: 'medium',
            sourceBlockIds: ['term'],
          },
        ],
      },
      semanticDoc,
      doc,
    )
    expect(merged.number.value).toBe('EDITED')
    expect(merged.payment.terms).toMatchObject({
      value: '14 Tage netto',
      extractionMethod: 'semantic',
      status: 'uncertain',
      source: { sourceItemIds: ['term'], page: 1 },
    })
  })

  it('runs the mock extractor end-to-end and preserves edits across reruns', async () => {
    const deterministic = await runInvoiceExtraction(doc)
    const first = await runInvoiceExtraction(doc, {
      pluginsById: [createMockSemanticPlugin()],
    })
    expect(deterministic.diagnostics).toEqual([])
    expect(first.draft).toBeDefined()
    expect(first.draft.number.value).toBe('RE-42')
    expect(first.draft.payment.terms).toMatchObject({
      extractionMethod: 'semantic',
    })
    expect(first.draft.payment.reference).toMatchObject({
      value: 'CUST-55',
      extractionMethod: 'semantic',
    })
    const edited = structuredClone(first.draft!)
    edited.payment.terms = editDraftField(edited.payment.terms, 'Sofort')
    const rerun = await runInvoiceExtraction(doc, {
      pluginsById: [createMockSemanticPlugin()],
      existingDraft: edited,
    })
    expect(rerun.draft?.payment.terms).toMatchObject({
      value: 'Sofort',
      status: 'user-edited',
      extractionMethod: 'user',
      originalExtractedValue: 'Zahlbar innerhalb von 14 Tagen',
    })
  })

  it('preserves reviewer-confirmed values through deterministic and semantic reruns', async () => {
    const first = await runInvoiceExtraction(doc)
    const confirmed = structuredClone(first.draft!)
    confirmed.payment.terms = {
      ...confirmed.payment.terms,
      value: 'Manually confirmed terms',
      status: 'user-confirmed',
    }
    const rerun = await runInvoiceExtraction(doc, { existingDraft: confirmed })
    expect(rerun.draft?.payment.terms).toMatchObject({
      value: 'Manually confirmed terms',
      status: 'user-confirmed',
    })
  })
})

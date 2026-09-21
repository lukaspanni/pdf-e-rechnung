import { createExtractionContext } from './context'
import {
  extractDocumentCandidates,
  extractLabelledTotalCandidates,
  extractVatCandidates,
} from './document-fields'
import { extractTableLines } from './line-items'
import { extractPaymentTerms } from './payment-terms'
import {
  emptyInvoiceCandidates,
  mergeEquivalentCandidates,
  rankCandidates,
} from './candidate-tools'
import { mapExtractionResultToDraft } from './draft'
import {
  createMockSemanticPlugin,
  createSemanticDocument,
  mergeSemanticResult,
  semanticExtractionResultSchema,
} from './semantic'
import type {
  ExtractedValue,
  ExtractionDiagnostic,
  ExtractionOptions,
  ExtractionRunResult,
  InvoiceExtractionCandidates,
} from './contracts'
import type { ExtractionContext } from './context'
import type { DocumentModel } from '@app/pdf-core'

const candidateFields: ReadonlyArray<keyof InvoiceExtractionCandidates> = [
  'ibans',
  'vatIds',
  'dates',
  'deliveryDates',
  'currencies',
  'invoiceNumbers',
  'dueDates',
  'netTotals',
  'taxTotals',
  'grossTotals',
  'paymentTerms',
  'sellerBlocks',
  'buyerBlocks',
  'lines',
  'amounts',
  'taxRates',
]

export async function runInvoiceExtraction(
  input: ExtractionContext | DocumentModel,
  options: ExtractionOptions = {},
): Promise<ExtractionRunResult> {
  const context = 'document' in input ? input : createExtractionContext(input)
  const diagnostics: Array<ExtractionDiagnostic> = []
  const candidates = emptyInvoiceCandidates()
  const append = (
    fields: Partial<InvoiceExtractionCandidates>,
    pluginId: string,
  ) => {
    for (const field of candidateFields) {
      const values = fields[field] as Array<ExtractedValue<unknown>> | undefined
      if (values?.length)
        (candidates[field] as Array<ExtractedValue<unknown>>).push(
          ...values.map((item) => ({
            ...item,
            provenance: item.provenance ?? { source: 'pdf-text', pluginId },
          })),
        )
    }
  }

  append(
    extractDocumentCandidates(
      context,
      options.invoiceNumberPatterns
        ? { invoiceNumberPatterns: options.invoiceNumberPatterns }
        : {},
    ),
    'document-fields',
  )
  append(extractLabelledTotalCandidates(context), 'labelled-totals')
  append(extractVatCandidates(context), 'vat')
  candidates.paymentTerms = extractPaymentTerms(context).map((item) => ({
    ...item,
    provenance: item.provenance ?? {
      source: 'pdf-text',
      pluginId: 'payment-terms',
    },
  }))
  candidates.lines = extractTableLines(context, options.lineItems).map(
    (item) => ({
      ...item,
      provenance: (item as ExtractedValue<unknown>).provenance ?? {
        source: 'pdf-text',
        pluginId: 'line-items',
      },
    }),
  )

  for (const field of candidateFields) {
    const merged = mergeEquivalentCandidates(field, candidates[field], '')
    candidates[field] = rankCandidates(merged, undefined) as never
  }

  // Reviewer decisions take precedence over extraction once, before semantic enrichment.
  let draft = mapExtractionResultToDraft(
    { candidates, diagnostics },
    options.existingDraft,
  )
  const sourceDocument = context.document
  const semanticDocument = createSemanticDocument(sourceDocument, {
    candidates,
    diagnostics,
  })
  const semanticContext = {
    ...context,
    phase: 'semantic' as const,
    semantic: { document: semanticDocument, draft, sourceDocument },
  }
  try {
    const result = await createMockSemanticPlugin().run(semanticContext, {})
    if (result.semanticResult !== undefined) {
      const semantic = semanticExtractionResultSchema.parse(
        result.semanticResult,
      )
      draft = mergeSemanticResult(
        draft,
        semantic,
        semanticDocument,
        sourceDocument,
      )
    }
  } catch (error) {
    diagnostics.push({
      code: 'semantic-extraction-failed',
      message:
        error instanceof Error ? error.message : 'Semantic extraction failed.',
      pluginId: 'mock-semantic',
    })
  }
  return { candidates, diagnostics, draft }
}

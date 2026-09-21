import type { BoundingBox, DocumentModel } from '@app/pdf-core'
import type { ExtractionContext } from './context'
import type { ExtractedLine, LineItemExtractionOptions } from './line-items'
import type { InvoiceDraft } from '@app/invoice-core'
import type { SemanticDocument } from './semantic'

export type ExtractionCertainty = 'low' | 'medium' | 'high'
export type EvidenceSource = 'pdf-text' | 'generated'
export type CandidateProvenance = {
  source: EvidenceSource
  pluginId?: string
  description?: string
}

export type ExtractedValue<T> = {
  value: T
  certainty: ExtractionCertainty
  page: number
  sourceText: string
  sourceItemIds: Array<string>
  provenance?: CandidateProvenance
  alternateEvidence?: Array<CandidateProvenance>
  boundingBox?: BoundingBox
  label?: string
  labelDistance?: number
}

export type ExtractedAmount = { minor: number; currency?: string }
export type InvoiceExtractionCandidates = {
  ibans: Array<ExtractedValue<string>>
  vatIds: Array<ExtractedValue<string>>
  dates: Array<ExtractedValue<string>>
  deliveryDates: Array<ExtractedValue<string>>
  amounts: Array<ExtractedValue<ExtractedAmount>>
  taxRates: Array<ExtractedValue<number>>
  currencies: Array<ExtractedValue<string>>
  invoiceNumbers: Array<ExtractedValue<string>>
  dueDates: Array<ExtractedValue<string>>
  netTotals: Array<ExtractedValue<ExtractedAmount>>
  taxTotals: Array<ExtractedValue<ExtractedAmount>>
  grossTotals: Array<ExtractedValue<ExtractedAmount>>
  paymentTerms: Array<ExtractedValue<string>>
  sellerBlocks: Array<ExtractedValue<Array<string>>>
  buyerBlocks: Array<ExtractedValue<Array<string>>>
  lines: Array<ExtractedValue<ExtractedLine>>
}

export type ExtractionFieldGroup = keyof InvoiceExtractionCandidates
export type ExtractionOptions = {
  /** Additional regular-expression sources used to find invoice numbers. */
  invoiceNumberPatterns?: ReadonlyArray<string>
  /** Header aliases and layout options for line-item extraction. */
  lineItems?: LineItemExtractionOptions
  /** Draft to preserve across re-extraction. */
  existingDraft?: InvoiceDraft
}

export type ExtractionDiagnostic = {
  code: string
  message: string
  pluginId?: string
}

export type PluginResult = {
  candidates?: Partial<InvoiceExtractionCandidates>
  semanticResult?: unknown
  diagnostics?: ReadonlyArray<ExtractionDiagnostic>
}

export type ExtractionPluginContext = ExtractionContext & {
  phase: 'deterministic' | 'semantic'
  semantic?: {
    document: SemanticDocument
    draft: InvoiceDraft
    sourceDocument: DocumentModel
  }
}

export type ExtractionPlugin<TOptions extends object = Record<string, never>> =
  {
    id: string
    phase?: 'deterministic' | 'semantic'
    fieldGroups: ReadonlyArray<ExtractionFieldGroup>
    priority: number
    run: (
      context: ExtractionPluginContext,
      options: TOptions,
    ) => Promise<PluginResult>
  }

export type StructuredOutputSchema<TOutput> = {
  parse: (value: unknown) => TOutput
}

/** Provider-neutral boundary for structured model extraction. */
export type AiExtractionAdapter<TPromptInput, TStructuredOutput> = {
  id: string
  fieldGroups: ReadonlyArray<ExtractionFieldGroup>
  priority: number
  createPromptInput: (context: ExtractionContext) => TPromptInput
  invoke: (input: {
    promptInput: TPromptInput
    sourcePdf: Uint8Array | undefined
  }) => Promise<unknown>
  outputSchema: StructuredOutputSchema<TStructuredOutput>
  mapEvidence: (
    output: TStructuredOutput,
    context: ExtractionContext,
  ) => Partial<InvoiceExtractionCandidates>
}

export type ExtractionRunResult = {
  candidates: InvoiceExtractionCandidates
  diagnostics: Array<ExtractionDiagnostic>
  draft?: InvoiceDraft
}

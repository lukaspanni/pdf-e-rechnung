import { mapExtractionResultToDraft } from './draft'

export type {
  AiExtractionAdapter,
  CandidateProvenance,
  ExtractionCertainty,
  ExtractionDiagnostic,
  ExtractionFieldGroup,
  ExtractionOptions,
  ExtractionPlugin,
  ExtractionRunResult,
  ExtractedAmount,
  ExtractedValue,
  InvoiceExtractionCandidates,
  PluginResult,
  StructuredOutputSchema,
} from './contracts'
export type {
  ExtractionBlock,
  ExtractionContext,
  ExtractionLine,
  TableCandidate,
} from './context'
export { createExtractionContext } from './context'
export { runInvoiceExtraction } from './runner'
export { createAiExtractionPlugin } from './ai-adapter'
export type {
  ExtractedLine,
  LineItemExtractionOptions,
  LineItemHeaderProfile,
  LineItemHeaderRole,
} from './line-items'
export { defaultLineItemHeaderProfiles } from './line-items'

export {
  normalizeCurrency,
  normalizeIban,
  normalizeVatId,
  parseAmount,
  parseDate,
  parseTaxRate,
} from './document-fields'

export { mapExtractionResultToDraft }
export {
  createMockSemanticPlugin,
  createSemanticDocument,
  mergeSemanticResult,
  semanticExtractionResultSchema,
} from './semantic'
export type {
  SemanticDocument,
  SemanticExtractionResult,
  SemanticFieldPath,
  SemanticFieldValue,
  SemanticPage,
  SemanticTextBlock,
} from './semantic'

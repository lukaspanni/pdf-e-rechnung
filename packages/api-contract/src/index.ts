import { parseVerifiedInvoice } from '@app/invoice-core'
import { z } from 'zod'
import type {
  SemanticDocument,
  SemanticExtractionResult,
} from '@app/invoice-extraction'
import type { VerifiedInvoice } from '@app/invoice-core'

/** Transport-neutral contract; no endpoint or runtime is implied. */
export type SemanticExtractionRequest = {
  document: SemanticDocument
}

export type SemanticExtractionResponse = SemanticExtractionResult

export type GenerateEInvoiceRequest = {
  invoice: VerifiedInvoice
  pdf: Uint8Array
}

export type GenerateEInvoiceResult = {
  pdf: Uint8Array
  profile: 'EN16931'
}

export type EInvoiceErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INVOICE'
  | 'GENERATION_FAILED'
  | 'VALIDATION_FAILED'

export type EInvoiceError = {
  code: EInvoiceErrorCode
  message: string
  details?: Array<string>
}

const verifiedInvoiceSchema = z.unknown().transform((value, context) => {
  try {
    return parseVerifiedInvoice(value)
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid invoice',
    })
    return z.NEVER
  }
})

export const generateEInvoiceRequestSchema = z.object({
  invoice: verifiedInvoiceSchema,
  pdf: z
    .instanceof(Uint8Array)
    .refine((pdf) => pdf.byteLength > 0, { message: 'PDF must not be empty' })
    .refine(
      (pdf) => [37, 80, 68, 70, 45].every((byte, index) => pdf[index] === byte),
      {
        message: 'PDF header is invalid',
      },
    ),
})

export function parseGenerateEInvoiceRequest(
  value: unknown,
): GenerateEInvoiceRequest {
  return generateEInvoiceRequestSchema.parse(value)
}

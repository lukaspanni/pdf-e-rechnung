import { generateEInvoiceRequestSchema } from '@app/api-contract'
import {
  ZugferdValidationError,
  extractZugferdXml,
  generateZugferdPdf,
  validateZugferdXml,
} from '@app/zugferd-adapter'
import type {
  EInvoiceErrorCode,
  GenerateEInvoiceRequest,
  GenerateEInvoiceResult,
} from '@app/api-contract'

export interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export class EInvoiceServiceError extends Error {
  constructor(
    readonly code: EInvoiceErrorCode,
    message: string,
    readonly details?: Array<string>,
  ) {
    super(message)
    this.name = 'EInvoiceServiceError'
  }
}

export async function generateEInvoice(
  request: GenerateEInvoiceRequest,
  logger: Logger,
  now: () => Date = () => new Date(),
): Promise<GenerateEInvoiceResult> {
  const parsed = generateEInvoiceRequestSchema.safeParse(request)
  if (!parsed.success) {
    throw new EInvoiceServiceError(
      'INVALID_REQUEST',
      'The invoice generation request is invalid.',
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    )
  }

  const startedAt = now()
  // Keep invoice identifiers out of operational logs.
  logger.info('Generating EN 16931 e-invoice')

  try {
    const pdf = await generateZugferdPdf(parsed.data.pdf, parsed.data.invoice)
    const xml = await extractZugferdXml(pdf)
    const validation = await validateZugferdXml(xml)
    if (!validation.valid) {
      throw new EInvoiceServiceError(
        'VALIDATION_FAILED',
        'Generated invoice failed EN 16931 validation.',
        validation.errors,
      )
    }
    const gross = parsed.data.invoice.grossTotalMinor / 100
    if (
      !xml.includes(parsed.data.invoice.number) ||
      (!xml.includes(String(gross)) && !xml.includes(gross.toFixed(2)))
    ) {
      throw new EInvoiceServiceError(
        'VALIDATION_FAILED',
        'Generated invoice values did not survive the PDF round trip.',
      )
    }
    logger.info('Generated EN 16931 e-invoice', {
      durationMs: now().getTime() - startedAt.getTime(),
    })
    return { pdf, profile: 'EN16931' }
  } catch (error) {
    if (error instanceof EInvoiceServiceError) throw error
    if (error instanceof ZugferdValidationError) {
      throw new EInvoiceServiceError(
        'VALIDATION_FAILED',
        'Invoice XML failed EN 16931 validation.',
        error.errors,
      )
    }
    const diagnostic =
      error instanceof Error ? error.message : 'Unknown failure'
    logger.error('E-invoice generation failed', {
      diagnostic,
    })
    throw new EInvoiceServiceError(
      'GENERATION_FAILED',
      'Invoice generation failed.',
    )
  }
}

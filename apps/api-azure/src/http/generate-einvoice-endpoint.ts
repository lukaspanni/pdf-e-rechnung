import { parseGenerateEInvoiceRequest } from '@app/api-contract'
import { EInvoiceServiceError, generateEInvoice } from '@app/einvoice-service'
import { maxUploadBytes, uploadTooLargeResponse } from './upload-limit'
import type { Logger } from '@app/einvoice-service'

type ValidationIssue = { path: Array<PropertyKey>; message: string }

export type EndpointResult = {
  status: number
  headers: Record<string, string>
  body: Uint8Array | string
}

const json = (status: number, value: unknown): EndpointResult => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
})

export async function handleGenerateEInvoiceForm(
  form: FormData,
  logger: Logger,
  now?: () => Date,
): Promise<EndpointResult> {
  const pdfPart = form.get('pdf')
  const invoicePart = form.get('invoice')
  if (!(pdfPart instanceof Blob) || typeof invoicePart !== 'string') {
    return json(400, {
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request requires pdf and invoice form fields.',
      },
    })
  }
  if (pdfPart.size > maxUploadBytes) {
    return json(413, uploadTooLargeResponse)
  }

  let invoice: unknown
  try {
    invoice = JSON.parse(invoicePart)
  } catch {
    return json(400, {
      error: {
        code: 'INVALID_REQUEST',
        message: 'Invoice must be valid JSON.',
      },
    })
  }

  let generationRequest
  try {
    generationRequest = parseGenerateEInvoiceRequest({
      invoice,
      pdf: new Uint8Array(await pdfPart.arrayBuffer()),
    })
  } catch (error) {
    return json(400, {
      error: {
        code: 'INVALID_INVOICE',
        message: 'Invoice data is invalid.',
        details: validationDetails(error),
      },
    })
  }

  try {
    const result = await generateEInvoice(generationRequest, logger, now)
    return {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="invoice-zugferd.pdf"',
      },
      body: result.pdf,
    }
  } catch (error) {
    if (error instanceof EInvoiceServiceError) {
      if (error.code === 'GENERATION_FAILED') {
        return json(500, {
          error: {
            code: error.code,
            message: 'Invoice generation failed.',
          },
        })
      }
      return json(error.code === 'VALIDATION_FAILED' ? 422 : 400, {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      })
    }
    logger.error('Unhandled invoice generation error', {
      error: error instanceof Error ? error.message : 'Unknown failure',
    })
    return json(500, {
      error: {
        code: 'GENERATION_FAILED',
        message: 'Invoice generation failed.',
      },
    })
  }
}

function validationDetails(error: unknown): Array<string> {
  if (!(error instanceof Error) || !('issues' in error)) return []
  const issues = (error as Error & { issues?: unknown }).issues
  if (!Array.isArray(issues)) return []
  return (issues as Array<ValidationIssue>).map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  )
}

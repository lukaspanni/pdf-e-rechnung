import type { VerifiedInvoice } from '@app/invoice-core'
import type { EInvoiceGenerator } from './einvoice-generator'

export class EInvoiceGenerationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'EInvoiceGenerationError'
  }
}

export function createHttpEInvoiceGenerator(
  baseUrl = import.meta.env['VITE_EINVOICE_API_BASE_URL'] ?? '',
  fetcher: typeof fetch = fetch,
): EInvoiceGenerator {
  return {
    async generate(pdf: Uint8Array, invoice: VerifiedInvoice) {
      const form = new FormData()
      form.append(
        'pdf',
        new Blob([Uint8Array.from(pdf).buffer], { type: 'application/pdf' }),
        'invoice.pdf',
      )
      form.append('invoice', JSON.stringify(invoice))
      const endpoint = `${baseUrl.replace(/\/$/, '')}/api/einvoices/generate`
      const response = await fetcher(endpoint, { method: 'POST', body: form })
      if (!response.ok) {
        let message = 'Die ZUGFeRD-Rechnung konnte nicht erstellt werden.'
        let code: string | undefined
        try {
          const body: unknown = await response.json()
          if (body && typeof body === 'object') {
            const error = (
              body as { error?: { message?: unknown; code?: unknown } }
            ).error
            if (typeof error?.message === 'string') message = error.message
            if (typeof error?.code === 'string') code = error.code
          }
        } catch {
          // Keep the user-facing fallback if the server response isn't JSON.
        }
        throw new EInvoiceGenerationError(message, code)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

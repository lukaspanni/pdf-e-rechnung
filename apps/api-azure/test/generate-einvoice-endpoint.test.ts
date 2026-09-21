import { describe, expect, it } from 'vitest'
import { mockInvoice } from '../../../packages/invoice-core/src/mock-invoice'
import { handleGenerateEInvoiceForm } from '../src/http/generate-einvoice-endpoint'
import type { Logger } from '@app/einvoice-service'

const logger: Logger = { info: () => {}, error: () => {} }

function formWithPdf(pdf: Blob) {
  const form = new FormData()
  form.set('pdf', pdf, 'invoice.pdf')
  form.set('invoice', JSON.stringify(mockInvoice))
  return form
}

describe('generate e-invoice endpoint', () => {
  it('rejects oversized PDF parts before reading their bytes', async () => {
    const pdf = new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])
    const result = await handleGenerateEInvoiceForm(formWithPdf(pdf), logger)

    expect(result.status).toBe(413)
    expect(JSON.parse(result.body as string)).toEqual({
      error: {
        code: 'UPLOAD_TOO_LARGE',
        message: 'Upload exceeds the 25 MiB limit.',
      },
    })
  })
})

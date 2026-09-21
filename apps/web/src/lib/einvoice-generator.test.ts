import { describe, expect, it, vi } from 'vitest'
import { mockInvoice } from '@app/invoice-core/mock-invoice'
import { parseVerifiedInvoice } from '@app/invoice-core'
import { createHttpEInvoiceGenerator } from './http-einvoice-generator'

describe('HTTP e-invoice generator', () => {
  it('sends PDF and invoice as multipart data and returns the PDF response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'application/pdf' },
      }),
    )
    const generator = createHttpEInvoiceGenerator(
      'https://api.example.test/',
      fetcher,
    )
    const result = await generator.generate(
      new Uint8Array([4, 5]),
      parseVerifiedInvoice(mockInvoice),
    )

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/api/einvoices/generate',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    )
    const form = fetcher.mock.calls[0]?.[1]?.body as FormData
    expect(form.get('invoice')).toBe(JSON.stringify(mockInvoice))
    expect(form.get('pdf')).toBeInstanceOf(Blob)
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('maps structured server errors to a client error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'VALIDATION_FAILED', message: 'Invalid XML' } },
          { status: 422 },
        ),
      )
    const generator = createHttpEInvoiceGenerator('', fetcher)
    await expect(
      generator.generate(
        new Uint8Array([1]),
        parseVerifiedInvoice(mockInvoice),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Invalid XML',
    })
  })
})

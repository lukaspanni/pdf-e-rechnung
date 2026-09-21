import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockInvoice } from '@app/invoice-core/mock-invoice'
import { parseVerifiedInvoice } from '@app/invoice-core'
import {
  extractZugferdXml,
  generateZugferdPdf,
  validateZugferdXml,
} from '@app/zugferd-adapter'
import { generateEInvoice } from '../src/index'
import type { EInvoiceServiceError, Logger } from '../src/index'

vi.mock('@app/zugferd-adapter', () => ({
  generateZugferdPdf: vi.fn(),
  extractZugferdXml: vi.fn(),
  validateZugferdXml: vi.fn(),
  ZugferdValidationError: class extends Error {
    errors: Array<string> = []
  },
}))

describe('generateEInvoice', () => {
  const logger = { info: vi.fn(), error: vi.fn() }
  const typedLogger: Logger = logger
  const now = vi.fn(() => new Date('2026-01-01T00:00:00Z'))
  const invoice = parseVerifiedInvoice(mockInvoice)
  const pdf = new Uint8Array([37, 80, 68, 70, 45, 1, 2])

  beforeEach(() => vi.clearAllMocks())

  it('generates and validates an invoice, then logs duration', async () => {
    const generated = new Uint8Array([3, 4])
    vi.mocked(generateZugferdPdf).mockResolvedValue(generated)
    vi.mocked(extractZugferdXml).mockResolvedValue(
      `<Invoice>${invoice.number}<GrandTotalAmount>357.00</GrandTotalAmount></Invoice>`,
    )
    vi.mocked(validateZugferdXml).mockResolvedValue({
      valid: true,
      profile: 'en16931',
      errors: [],
    })

    await expect(
      generateEInvoice({ invoice, pdf }, typedLogger, now),
    ).resolves.toEqual({
      pdf: generated,
      profile: 'EN16931',
    })
    expect(generateZugferdPdf).toHaveBeenCalledWith(pdf, invoice)
    expect(validateZugferdXml).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledTimes(2)
  })

  it('maps invalid requests to structured application errors', async () => {
    await expect(
      generateEInvoice({ invoice, pdf: new Uint8Array() }, typedLogger, now),
    ).rejects.toMatchObject<EInvoiceServiceError>({
      code: 'INVALID_REQUEST',
    })
  })

  it('rejects failed extracted XML validation', async () => {
    vi.mocked(generateZugferdPdf).mockResolvedValue(new Uint8Array([3]))
    vi.mocked(extractZugferdXml).mockResolvedValue(invoice.number)
    vi.mocked(validateZugferdXml).mockResolvedValue({
      valid: false,
      profile: 'en16931',
      errors: ['bad XML'],
    })
    await expect(
      generateEInvoice({ invoice, pdf }, typedLogger, now),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: ['bad XML'],
    })
  })

  it('logs generation diagnostics without exposing them in the service error', async () => {
    vi.mocked(generateZugferdPdf).mockRejectedValue(new Error('corrupt PDF'))
    await expect(
      generateEInvoice({ invoice, pdf }, typedLogger, now),
    ).rejects.toMatchObject({
      code: 'GENERATION_FAILED',
      message: 'Invoice generation failed.',
      details: undefined,
    })
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith('E-invoice generation failed', {
      diagnostic: 'corrupt PDF',
    })
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ invoiceNumber: invoice.number }),
    )
  })
})

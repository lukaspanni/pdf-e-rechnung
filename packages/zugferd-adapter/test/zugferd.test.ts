import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseInvoice, parseVerifiedInvoice } from '@app/invoice-core'
import { mockInvoice } from '@app/invoice-core/mock-invoice'
import {
  createZugferdXml,
  extractZugferdXml,
  generateZugferdPdf,
  validateZugferdXml,
} from '../src/index'

describe('ZUGFeRD adapter', () => {
  const verifiedInvoice = parseVerifiedInvoice(mockInvoice)

  it('maps the invoice and zero-rated VAT to the CII XML contract', async () => {
    const zeroRated = parseInvoice({
      ...mockInvoice,
      lines: [
        {
          ...mockInvoice.lines[0],
          quantity: 1,
          unitPriceMinor: 100,
          netAmountMinor: 100,
          vatCategory: 'Z',
          vatRateBasisPoints: 0,
        },
      ],
      vatBreakdown: [
        {
          vatCategory: 'Z',
          rateBasisPoints: 0,
          taxableAmountMinor: 100,
          taxAmountMinor: 0,
        },
      ],
      netTotalMinor: 100,
      taxTotalMinor: 0,
      grossTotalMinor: 100,
    })
    const xml = await createZugferdXml(parseVerifiedInvoice(zeroRated))
    expect(xml).toContain('<ram:ID>RE-2026-0001</ram:ID>')
    expect(xml).toContain('<ram:CategoryCode>Z</ram:CategoryCode>')
    expect(xml).toContain(
      '<ram:RateApplicablePercent>0</ram:RateApplicablePercent>',
    )
  })

  it('generates validated EN 16931 XML and round-trips it through a PDF', async () => {
    const xml = await createZugferdXml(verifiedInvoice)
    const validation = await validateZugferdXml(xml)
    expect(validation.valid).toBe(true)
    expect(validation.profile).toBe('en16931')
    expect(xml).toContain(mockInvoice.number)
    expect(xml).toContain(mockInvoice.seller.name)

    const sourcePdf = new Uint8Array(
      await readFile(
        new URL('../../../test-data/sample-invoice.pdf', import.meta.url),
      ),
    )
    const pdf = await generateZugferdPdf(sourcePdf, verifiedInvoice)
    const extractedXml = await extractZugferdXml(pdf)
    expect(extractedXml).toContain(mockInvoice.number)
    expect(extractedXml).toContain(mockInvoice.seller.name)
    expect(extractedXml).toContain('urn:cen.eu:en16931:2017')
    expect(extractedXml).toContain('357')
  }, 30_000)
})

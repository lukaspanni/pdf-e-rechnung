import { describe, expect, it } from 'vitest'
import { validateInvoiceDraft } from '@app/invoice-core'
import {
  mapExtractionResultToDraft,
  normalizeCurrency,
  normalizeIban,
  normalizeVatId,
  parseAmount,
  parseDate,
  parseTaxRate,
  runInvoiceExtraction,
} from '../src/index.ts'
import type { DocumentModel } from '@app/pdf-core'
import type { LineItemExtractionOptions } from '../src/index'

function document(
  items: DocumentModel['pages'][number]['textItems'],
): DocumentModel {
  return { pages: [{ number: 1, textItems: items }] }
}

const box = (x: number, y = 100) => ({ x, y, width: 60, height: 12 })

async function extractWithPlugins(
  input: DocumentModel,
  lineItems?: LineItemExtractionOptions,
) {
  const result = await runInvoiceExtraction(input, { lineItems })
  return result.candidates
}

describe('normalizers', () => {
  it('recognizes and normalizes an IBAN', () => {
    expect(normalizeIban('DE89 3704 0044 0532 0130 00')).toBe(
      'DE89370400440532013000',
    )
    expect(normalizeIban('DE00 3704 0044 0532 0130 00')).toBeNull()
  })

  it('recognizes VAT IDs and currencies', () => {
    expect(normalizeVatId('DE 123456789')).toBe('DE123456789')
    expect(normalizeCurrency('€')).toBe('EUR')
    expect(normalizeCurrency('EUR')).toBe('EUR')
  })

  it('parses calendar dates, decimal formats, and VAT rates', () => {
    expect(parseDate('22.09.2026')).toBe('2026-09-22')
    expect(parseDate('2026-02-29')).toBeNull()
    expect(parseAmount('1.000,00')).toBe(100000)
    expect(parseAmount('1,000.00')).toBe(100000)
    expect(parseAmount('1.000')).toBe(100000)
    expect(parseAmount('1,000')).toBe(100000)
    expect(parseAmount('1200 EUR')).toBeNull()
    expect(parseAmount('1200')).toBe(120000)
    expect(parseTaxRate('19,0%')).toBe(19)
  })
})

describe('configured invoice extraction', () => {
  it('preserves source locations and boosts nearby labelled values', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'label', text: 'Rechnungsdatum', boundingBox: box(10) },
        { id: 'date', text: '22.09.2026', boundingBox: box(90) },
        { id: 'iban-label', text: 'IBAN', boundingBox: box(10, 70) },
        {
          id: 'iban',
          text: 'DE89 3704 0044 0532 0130 00',
          boundingBox: box(90, 70),
        },
        { id: 'vat', text: 'USt-IdNr. DE123456789', boundingBox: box(10, 40) },
        { id: 'total', text: 'Gesamt 1.190,00 EUR', boundingBox: box(10, 10) },
        { id: 'rate', text: 'MwSt 19%', boundingBox: box(10, 0) },
      ]),
    )

    expect(result.dates[0]).toMatchObject({
      value: '2026-09-22',
      certainty: 'high',
      page: 1,
      sourceItemIds: ['date'],
      boundingBox: box(90),
    })
    expect(result.ibans[0]).toMatchObject({
      value: 'DE89370400440532013000',
      certainty: 'high',
    })
    expect(result.vatIds[0]?.value).toBe('DE123456789')
    expect(result.amounts[0]?.value).toEqual({ minor: 119000, currency: 'EUR' })
    expect(result.taxRates[0]?.value).toBe(19)
    expect(result.currencies.map((candidate) => candidate.value)).toEqual([
      'EUR',
    ])
  })

  it('returns dates as candidates and deduplicates repeated values', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'first', text: '22.09.2026', boundingBox: box(10) },
        { id: 'repeat', text: '22.09.2026', boundingBox: box(10, 80) },
        { id: 'second', text: '30.09.2026', boundingBox: box(10, 60) },
        { id: 'third', text: '14.10.2026', boundingBox: box(10, 40) },
      ]),
    )

    expect(result.dates.map((candidate) => candidate.value)).toEqual([
      '2026-09-22',
      '2026-09-30',
      '2026-10-14',
    ])
  })

  it('uses an invoice-number label only when it has a simple nearby value', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'number-label', text: 'Invoice No.', boundingBox: box(10) },
        { id: 'number', text: 'INV-2026-42', boundingBox: box(90) },
      ]),
    )

    expect(result.invoiceNumbers[0]).toMatchObject({
      value: 'INV-2026-42',
      certainty: 'high',
    })
  })

  it('recognizes German invoice numbers following Rechnung with a separator', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'number', text: 'Rechnung #RE-2026-0042', boundingBox: box(10) },
      ]),
    )

    expect(result.invoiceNumbers[0]).toMatchObject({
      value: 'RE-2026-0042',
      certainty: 'high',
    })
  })

  it('uses configured invoice-number regexes and captures the first group', async () => {
    const result = await runInvoiceExtraction(
      document([
        {
          id: 'template-title',
          text: 'Wartung und Erweiterung des Warenwirtschaftssystems EW-2026-071',
          boundingBox: box(10),
        },
      ]),
      { invoiceNumberPatterns: ['\\b(EW-\\d{4}-\\d{3})\\b'] },
    )

    expect(result.candidates.invoiceNumbers[0]).toMatchObject({
      value: 'EW-2026-071',
      certainty: 'high',
      sourceItemIds: ['template-title'],
      provenance: { pluginId: 'document-fields', source: 'pdf-text' },
    })
  })

  it('ignores invalid configured invoice-number regexes', async () => {
    const result = await runInvoiceExtraction(
      document([{ id: 'text', text: 'Invoice EW-2026-071' }]),
      { invoiceNumberPatterns: ['['] },
    )

    expect(result.candidates.invoiceNumbers).toEqual([])
  })

  it('recognizes German VAT IDs without requiring a label', async () => {
    const result = await extractWithPlugins(
      document([{ id: 'vat', text: 'DE123456789', boundingBox: box(10) }]),
    )

    expect(result.vatIds.map((item) => item.value)).toEqual(['DE123456789'])
  })

  it('ranks labelled German invoice totals ahead of line amounts', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'line', text: '210,08€', boundingBox: box(440, 476) },
        { id: 'net-label', text: 'Summe:', boundingBox: box(389, 427) },
        { id: 'net', text: '252,10€', boundingBox: box(438, 427) },
        {
          id: 'tax-label',
          text: '19% Mehrwertsteuer:',
          boundingBox: box(330, 410),
        },
        { id: 'tax', text: '47,90€', boundingBox: box(443, 410) },
        { id: 'gross-label', text: 'Gesamt:', boundingBox: box(385, 392) },
        { id: 'gross', text: '300,00€', boundingBox: box(434, 392) },
      ]),
    )

    expect(result.netTotals[0]?.value.minor).toBe(25210)
    expect(result.taxTotals[0]?.value.minor).toBe(4790)
    expect(result.grossTotals[0]?.value.minor).toBe(30000)
    expect(result.taxTotals[0]?.label).toBe('19% Mehrwertsteuer:')
  })

  it('extracts integer money amounts when a currency is present', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'net', text: 'Nettosumme 1.200 EUR', boundingBox: box(10) },
        { id: 'gross', text: 'Gesamt 1200 €', boundingBox: box(10, 80) },
      ]),
    )
    expect(result.netTotals[0]?.value).toEqual({
      minor: 120000,
      currency: 'EUR',
    })
    expect(result.grossTotals[0]?.value).toEqual({
      minor: 120000,
      currency: 'EUR',
    })
    expect(result.amounts.map((amount) => amount.value.minor)).not.toContain(
      1043500,
    )
  })

  it('retains competing money candidates as alternatives on draft totals', async () => {
    const result = await runInvoiceExtraction(
      document([
        { id: 'line-amount', text: '210,08€', boundingBox: box(440, 476) },
        { id: 'net-label', text: 'Summe:', boundingBox: box(389, 427) },
        { id: 'net', text: '252,10€', boundingBox: box(438, 427) },
      ]),
    )
    const draft = mapExtractionResultToDraft(result)

    expect(draft.netTotalMinor.value).toBe(25210)
    expect(draft.netTotalMinor.alternatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 21008 })]),
    )
    expect(
      draft.netTotalMinor.alternatives?.[0]?.source?.sourceItemIds,
    ).toEqual(['line-amount'])
  })

  it('finds unlabelled multi-line German address blocks but rejects prose', async () => {
    const result = await extractWithPlugins({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'name',
              text: 'Hanseatischer Werkstattbedarf GmbH',
              boundingBox: box(120, 616),
            },
            {
              id: 'street',
              text: 'Am Sandtorkai 42',
              boundingBox: box(120, 602),
            },
            {
              id: 'postal-city',
              text: '20457 Hamburg',
              boundingBox: box(120, 588),
            },
            {
              id: 'sentence',
              text: 'Vielen Dank für die Zusammenarbeit',
              boundingBox: box(120, 550),
            },
            {
              id: 'sentence2',
              text: 'Rechnungssumme überweisen Sie bitte',
              boundingBox: box(120, 536),
            },
            {
              id: 'sentence3',
              text: 'innerhalb von 14 Tagen',
              boundingBox: box(120, 522),
            },
          ],
        },
      ],
    })

    expect(result.buyerBlocks[0]?.value).toEqual([
      'Hanseatischer Werkstattbedarf GmbH',
      'Am Sandtorkai 42',
      '20457 Hamburg',
    ])
    expect(result.sellerBlocks).toHaveLength(0)
  })

  it('keeps additional address lines together in the street field', async () => {
    const result = await runInvoiceExtraction({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'seller-name',
              text: 'Example GmbH',
              boundingBox: box(10, 200),
            },
            {
              id: 'seller-street-one',
              text: 'Hauptstraße 4',
              boundingBox: box(10, 186),
            },
            {
              id: 'seller-street-two',
              text: 'Gebäude B, 2. OG',
              boundingBox: box(10, 172),
            },
            {
              id: 'seller-city',
              text: '10115 Berlin',
              boundingBox: box(10, 158),
            },
            {
              id: 'buyer-name',
              text: 'Customer AG',
              boundingBox: box(300, 200),
            },
            {
              id: 'buyer-street',
              text: 'Parkweg 2',
              boundingBox: box(300, 186),
            },
            {
              id: 'buyer-city',
              text: '20095 Hamburg',
              boundingBox: box(300, 172),
            },
          ],
        },
      ],
    })
    expect(result.candidates.sellerBlocks[0]?.value).toEqual([
      'Example GmbH',
      'Hauptstraße 4',
      'Gebäude B, 2. OG',
      '10115 Berlin',
    ])
    const draft = mapExtractionResultToDraft(result)
    expect(draft.seller.street.value).toBe('Hauptstraße 4, Gebäude B, 2. OG')
    expect(draft.seller.street.source?.sourceItemIds).toContain(
      'seller-street-two',
    )
  })

  it('extracts the unlabeled sender and recipient from the sample invoice layout', async () => {
    const result = await extractWithPlugins({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'seller-name',
              text: 'Nordlicht Digitalberatung GmbH',
              boundingBox: box(119, 666),
            },
            {
              id: 'seller-street',
              text: 'Kastanienallee 27',
              boundingBox: box(119, 652),
            },
            {
              id: 'seller-city',
              text: '10435 Berlin',
              boundingBox: box(119, 638),
            },
            {
              id: 'buyer-name',
              text: 'Hanseatischer Werkstattbedarf GmbH',
              boundingBox: box(119, 616),
            },
            {
              id: 'buyer-street',
              text: 'Am Sandtorkai 42',
              boundingBox: box(119, 602),
            },
            {
              id: 'buyer-city',
              text: '20457 Hamburg',
              boundingBox: box(119, 588),
            },
          ],
        },
      ],
    })

    expect(result.sellerBlocks[0]?.value).toEqual([
      'Nordlicht Digitalberatung GmbH',
      'Kastanienallee 27',
      '10435 Berlin',
    ])
    expect(result.buyerBlocks[0]?.value).toEqual([
      'Hanseatischer Werkstattbedarf GmbH',
      'Am Sandtorkai 42',
      '20457 Hamburg',
    ])
  })

  it('derives DE for plausible five-digit German address blocks', async () => {
    const result = await runInvoiceExtraction({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'seller-name',
              text: 'Nordlicht GmbH',
              boundingBox: box(119, 666),
            },
            {
              id: 'seller-street',
              text: 'Kastanienallee 27',
              boundingBox: box(119, 652),
            },
            {
              id: 'seller-city',
              text: '10435 Berlin',
              boundingBox: box(119, 638),
            },
            {
              id: 'buyer-name',
              text: 'Hanseatischer Werkstattbedarf GmbH',
              boundingBox: box(119, 616),
            },
            {
              id: 'buyer-street',
              text: 'Am Sandtorkai 42',
              boundingBox: box(119, 602),
            },
            {
              id: 'buyer-city',
              text: '20457 Hamburg',
              boundingBox: box(119, 588),
            },
          ],
        },
      ],
    })
    const draft = mapExtractionResultToDraft(result)
    expect(draft.seller.countryCode).toMatchObject({
      value: 'DE',
      status: 'uncertain',
    })
    expect(draft.buyer.countryCode).toMatchObject({
      value: 'DE',
      status: 'uncertain',
    })
  })

  it('distinguishes service date from invoice issue date', async () => {
    const result = await runInvoiceExtraction(
      document([
        {
          id: 'issue-label',
          text: 'Rechnungsdatum',
          boundingBox: box(10, 100),
        },
        { id: 'issue-date', text: '22.09.2026', boundingBox: box(90, 100) },
        {
          id: 'service-label',
          text: 'Leistungsdatum',
          boundingBox: box(10, 80),
        },
        { id: 'service-date', text: '30.09.2026', boundingBox: box(90, 80) },
      ]),
    )
    const draft = mapExtractionResultToDraft(result)
    expect(draft.issueDate.value).toBe('2026-09-22')
    expect(draft.deliveryDate).toMatchObject({
      value: '2026-09-30',
      extractionMethod: 'deterministic',
      source: { sourceItemIds: ['service-date'] },
    })
  })

  it('derives a due date only from one labelled issue date and one relative term', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'date-label', text: 'Rechnungsdatum', boundingBox: box(10, 100) },
        { id: 'issue-date', text: '22.09.2026', boundingBox: box(90, 100) },
        {
          id: 'terms',
          text: 'Zahlbar innerhalb von 14 Tagen',
          boundingBox: box(10, 70),
        },
      ]),
    )
    expect(result.dueDates[0]).toMatchObject({
      value: '2026-10-06',
      certainty: 'high',
      sourceItemIds: ['terms'],
    })
    const ambiguous = await extractWithPlugins(
      document([
        {
          id: 'issue-label',
          text: 'Rechnungsdatum',
          boundingBox: box(10, 100),
        },
        { id: 'issue-date', text: '22.09.2026', boundingBox: box(90, 100) },
        {
          id: 'second-date-label',
          text: 'Rechnungsdatum',
          boundingBox: box(10, 80),
        },
        { id: 'other-date', text: '23.09.2026', boundingBox: box(90, 80) },
        {
          id: 'terms',
          text: 'innerhalb von 14 Tagen',
          boundingBox: box(10, 70),
        },
      ]),
    )
    expect(ambiguous.dueDates).toHaveLength(0)
  })

  it('extracts decimal table quantities', async () => {
    const result = await extractWithPlugins(
      document([
        {
          id: 'description-head',
          text: 'Bezeichnung',
          boundingBox: { x: 10, y: 200, width: 60, height: 12 },
        },
        {
          id: 'quantity-head',
          text: 'Menge',
          boundingBox: { x: 100, y: 200, width: 60, height: 12 },
        },
        {
          id: 'price-head',
          text: 'Einzelpreis',
          boundingBox: { x: 200, y: 200, width: 60, height: 12 },
        },
        {
          id: 'total-head',
          text: 'Betrag',
          boundingBox: { x: 300, y: 200, width: 60, height: 12 },
        },
        {
          id: 'description',
          text: 'Beratung',
          boundingBox: { x: 10, y: 180, width: 60, height: 12 },
        },
        {
          id: 'quantity',
          text: '1,5',
          boundingBox: { x: 100, y: 180, width: 60, height: 12 },
        },
        {
          id: 'price',
          text: '2,00',
          boundingBox: { x: 200, y: 180, width: 60, height: 12 },
        },
        {
          id: 'total',
          text: '3,00',
          boundingBox: { x: 300, y: 180, width: 60, height: 12 },
        },
      ]),
    )
    expect(result.lines[0]?.value).toMatchObject({
      description: 'Beratung',
      quantity: 1.5,
      unitPriceMinor: 200,
      netAmountMinor: 300,
    })
  })

  it('continues item table columns onto pages without repeated headers', async () => {
    const result = await runInvoiceExtraction({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'h-description',
              text: 'Beschreibung',
              boundingBox: box(10, 700),
            },
            { id: 'h-quantity', text: 'Menge', boundingBox: box(150, 700) },
            { id: 'h-price', text: 'Einzelpreis', boundingBox: box(250, 700) },
            { id: 'h-total', text: 'Betrag', boundingBox: box(360, 700) },
            {
              id: 'p1-description',
              text: 'Erste Leistung',
              boundingBox: box(10, 680),
            },
            { id: 'p1-quantity', text: '2', boundingBox: box(150, 680) },
            { id: 'p1-price', text: '50,00', boundingBox: box(250, 680) },
            { id: 'p1-total', text: '100,00', boundingBox: box(360, 680) },
          ],
        },
        {
          number: 2,
          textItems: [
            {
              id: 'p2-description',
              text: 'Zweite Leistung',
              boundingBox: box(10, 680),
            },
            { id: 'p2-quantity', text: '1', boundingBox: box(150, 680) },
            { id: 'p2-price', text: '25,00', boundingBox: box(250, 680) },
            { id: 'p2-total', text: '25,00', boundingBox: box(360, 680) },
          ],
        },
      ],
    })
    expect(
      result.candidates.lines.map((line) => line.value.description),
    ).toEqual(['Erste Leistung', 'Zweite Leistung'])
    expect(result.candidates.lines.map((line) => line.page)).toEqual([1, 2])
  })

  it('maps multiple tax rates to matching line and VAT groups', async () => {
    const result = await runInvoiceExtraction({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'description-head',
              text: 'Beschreibung',
              boundingBox: box(10, 300),
            },
            { id: 'quantity-head', text: 'Menge', boundingBox: box(100, 300) },
            {
              id: 'price-head',
              text: 'Einzelpreis',
              boundingBox: box(200, 300),
            },
            { id: 'total-head', text: 'Betrag', boundingBox: box(300, 300) },
            { id: 'vat-head', text: 'USt', boundingBox: box(400, 300) },
            { id: 'd1', text: 'Standard', boundingBox: box(10, 280) },
            { id: 'q1', text: '1', boundingBox: box(100, 280) },
            { id: 'p1', text: '100,00', boundingBox: box(200, 280) },
            { id: 't1', text: '100,00', boundingBox: box(300, 280) },
            { id: 'v1', text: '19%', boundingBox: box(400, 280) },
            { id: 'd2', text: 'Reduced', boundingBox: box(10, 260) },
            { id: 'q2', text: '1', boundingBox: box(100, 260) },
            { id: 'p2', text: '50,00', boundingBox: box(200, 260) },
            { id: 't2', text: '50,00', boundingBox: box(300, 260) },
            { id: 'v2', text: '7%', boundingBox: box(400, 260) },
            { id: 'net-label', text: 'Nettosumme', boundingBox: box(10, 100) },
            { id: 'net', text: '150,00 EUR', boundingBox: box(300, 100) },
            {
              id: 'vat19',
              text: '19% Umsatzsteuer 19,00 EUR',
              boundingBox: box(10, 80),
            },
            {
              id: 'vat7',
              text: '7% Umsatzsteuer 3,50 EUR',
              boundingBox: box(10, 60),
            },
          ],
        },
      ],
    })
    const draft = mapExtractionResultToDraft(result)
    expect(
      result.candidates.lines
        .map((line) => line.value.vatRateBasisPoints)
        .filter((rate) => rate !== undefined),
    ).toEqual([1900, 700])
    expect(
      draft.lines
        .map((line) => line.vatRateBasisPoints.value)
        .filter((rate) => rate !== undefined),
    ).toEqual([1900, 700])
    expect(draft.vatBreakdown).toHaveLength(2)
    expect(draft.vatBreakdown.map((vat) => vat.rateBasisPoints.value)).toEqual([
      1900, 700,
    ])
    expect(
      draft.vatBreakdown.map((vat) => vat.taxableAmountMinor.value),
    ).toEqual([10000, 5000])
    expect(draft.vatBreakdown.map((vat) => vat.taxAmountMinor.value)).toEqual([
      1900, 350,
    ])
    expect(
      validateInvoiceDraft(draft).filter((issue) =>
        /^lines\.\d+\.vatRateBasisPoints$/.test(issue.path),
      ),
    ).toEqual([])
  })

  it('extracts standard English item-table headers', async () => {
    const result = await extractWithPlugins(
      document([
        {
          id: 'description-head',
          text: 'Description',
          boundingBox: box(10, 200),
        },
        { id: 'quantity-head', text: 'Quantity', boundingBox: box(100, 200) },
        { id: 'unit-head', text: 'Unit', boundingBox: box(170, 200) },
        { id: 'price-head', text: 'Unit price', boundingBox: box(240, 200) },
        { id: 'total-head', text: 'Line total', boundingBox: box(350, 200) },
        { id: 'description', text: 'Design work', boundingBox: box(10, 180) },
        { id: 'quantity', text: '3', boundingBox: box(100, 180) },
        { id: 'unit', text: 'hours', boundingBox: box(170, 180) },
        { id: 'price', text: '40.00', boundingBox: box(240, 180) },
        { id: 'total', text: '120.00', boundingBox: box(350, 180) },
      ]),
    )

    expect(result.lines[0]?.value).toMatchObject({
      description: 'Design work',
      quantity: 3,
      unitPriceMinor: 4000,
      netAmountMinor: 12000,
    })
  })

  it('skips repeated table headers on subsequent pages', async () => {
    const page = (number: number, suffix: string) => ({
      number,
      textItems: [
        {
          id: `description-head-${suffix}`,
          text: 'Beschreibung',
          boundingBox: box(10, 200),
        },
        {
          id: `quantity-head-${suffix}`,
          text: 'Menge',
          boundingBox: box(100, 200),
        },
        {
          id: `price-head-${suffix}`,
          text: 'Einzelpreis',
          boundingBox: box(200, 200),
        },
        {
          id: `total-head-${suffix}`,
          text: 'Betrag',
          boundingBox: box(300, 200),
        },
        {
          id: `description-${suffix}`,
          text: `Leistung ${suffix}`,
          boundingBox: box(10, 180),
        },
        { id: `quantity-${suffix}`, text: '1', boundingBox: box(100, 180) },
        { id: `price-${suffix}`, text: '10,00', boundingBox: box(200, 180) },
        { id: `total-${suffix}`, text: '10,00', boundingBox: box(300, 180) },
      ],
    })
    const result = await runInvoiceExtraction({
      pages: [page(1, 'one'), page(2, 'two')],
    })
    expect(
      result.candidates.lines.map((line) => line.value.description),
    ).toEqual(['Leistung one', 'Leistung two'])
  })

  it('extracts compact German item tables and joins wrapped descriptions', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'position-head', text: 'Pos.', boundingBox: box(126, 200) },
        {
          id: 'description-head',
          text: 'Beschreibung',
          boundingBox: box(154, 200),
        },
        { id: 'price-head', text: 'Preis', boundingBox: box(446, 200) },
        {
          id: 'position-one',
          text: '1.',
          boundingBox: { x: 138, y: 180, width: 8, height: 12 },
        },
        {
          id: 'description-one',
          text: 'IT-Beratung und Prozessanalyse – September 2026 (2',
          boundingBox: { x: 154, y: 180, width: 239, height: 12 },
        },
        {
          id: 'description-one-continuation',
          text: 'Stunden)',
          boundingBox: { x: 154, y: 166, width: 41, height: 12 },
        },
        {
          id: 'price-one',
          text: '210,08€',
          boundingBox: { x: 438, y: 180, width: 34, height: 12 },
        },
        {
          id: 'position-two',
          text: '2.',
          boundingBox: { x: 138, y: 150, width: 8, height: 12 },
        },
        {
          id: 'description-two',
          text: 'Dokumentation und Handlungsempfehlungen',
          boundingBox: { x: 154, y: 150, width: 208, height: 12 },
        },
        {
          id: 'price-two',
          text: '42,02€',
          boundingBox: { x: 443, y: 150, width: 28, height: 12 },
        },
      ]),
    )

    expect(result.lines.map((line) => line.value)).toEqual([
      {
        description:
          'IT-Beratung und Prozessanalyse – September 2026 (2 Stunden)',
        quantity: 1,
        unitPriceMinor: 21008,
        netAmountMinor: 21008,
      },
      {
        description: 'Dokumentation und Handlungsempfehlungen',
        quantity: 1,
        unitPriceMinor: 4202,
        netAmountMinor: 4202,
      },
    ])
    expect(result.lines[0]?.sourceItemIds).toContain(
      'description-one-continuation',
    )
  })

  it('supports configured header profiles', async () => {
    const result = await extractWithPlugins(
      document([
        { id: 'detail-head', text: 'Details', boundingBox: box(10, 200) },
        { id: 'units-head', text: 'Units', boundingBox: box(120, 200) },
        { id: 'rate-head', text: 'Rate', boundingBox: box(220, 200) },
        { id: 'amount-head', text: 'Extended', boundingBox: box(320, 200) },
        { id: 'detail', text: 'Consulting', boundingBox: box(10, 180) },
        { id: 'units', text: '2', boundingBox: box(120, 180) },
        { id: 'rate', text: '50.00', boundingBox: box(220, 180) },
        { id: 'amount', text: '100.00', boundingBox: box(320, 180) },
      ]),
      {
        includeHeaderless: false,
        headerProfiles: [
          {
            id: 'custom',
            kind: 'quantity-price',
            headers: {
              description: ['details'],
              quantity: ['units'],
              unitPrice: ['rate'],
              lineTotal: ['extended'],
            },
          },
        ],
      },
    )

    expect(result.lines[0]?.value).toMatchObject({
      description: 'Consulting',
      quantity: 2,
      unitPriceMinor: 5000,
      netAmountMinor: 10000,
    })
  })

  it('uses lower-certainty row and amount alignment without recognized headers', async () => {
    const result = await extractWithPlugins(
      document([
        {
          id: 'first-description',
          text: 'Consulting',
          boundingBox: box(10, 180),
        },
        { id: 'first-price', text: '100,00€', boundingBox: box(400, 180) },
        {
          id: 'second-description',
          text: 'Documentation',
          boundingBox: box(10, 150),
        },
        { id: 'second-price', text: '50,00€', boundingBox: box(400, 150) },
      ]),
    )

    expect(result.lines.map((line) => line.value)).toEqual([
      {
        description: 'Consulting',
        quantity: 1,
        unitPriceMinor: 10000,
        netAmountMinor: 10000,
      },
      {
        description: 'Documentation',
        quantity: 1,
        unitPriceMinor: 5000,
        netAmountMinor: 5000,
      },
    ])
    expect(result.lines.map((line) => line.certainty)).toEqual(['low', 'low'])
  })

  it('extracts a compact one-line sender address only as the sender', async () => {
    const result = await extractWithPlugins({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'sender-line',
              text: 'Nordlicht Digitalberatung GmbH • Kastanienallee 27 • 10435',
              boundingBox: { x: 119, y: 666, width: 323, height: 12 },
            },
            {
              id: 'sender-city',
              text: 'Berlin',
              boundingBox: box(119, 652),
            },
            {
              id: 'buyer-name',
              text: 'Hanseatischer Werkstattbedarf GmbH',
              boundingBox: box(119, 616),
            },
            {
              id: 'buyer-street',
              text: 'Am Sandtorkai 42',
              boundingBox: box(119, 602),
            },
            {
              id: 'buyer-city',
              text: '20457 Hamburg',
              boundingBox: box(119, 588),
            },
          ],
        },
      ],
    })

    expect(result.sellerBlocks[0]?.value).toEqual([
      'Nordlicht Digitalberatung GmbH',
      'Kastanienallee 27',
      '10435 Berlin',
    ])
    expect(result.buyerBlocks[0]?.value).toEqual([
      'Hanseatischer Werkstattbedarf GmbH',
      'Am Sandtorkai 42',
      '20457 Hamburg',
    ])
  })

  it('does not treat a compact recipient line as the sender address', async () => {
    const result = await extractWithPlugins({
      pages: [
        {
          number: 1,
          textItems: [
            {
              id: 'recipient-line',
              text: 'Hanseatischer Werkstattbedarf GmbH • Am Sandtorkai 42 • 20457 Hamburg',
              boundingBox: { x: 119, y: 616, width: 323, height: 12 },
            },
          ],
        },
      ],
    })

    expect(result.sellerBlocks).toHaveLength(0)
    expect(result.buyerBlocks).toHaveLength(0)
  })

  it('builds a review draft with source evidence and uncertain table rows', async () => {
    const result = await runInvoiceExtraction(
      document([
        { id: 'number-label', text: 'Invoice No.', boundingBox: box(10, 500) },
        { id: 'number', text: 'INV-42', boundingBox: box(90, 500) },
        { id: 'seller', text: 'Seller', boundingBox: box(10, 450) },
        { id: 'seller-name', text: 'Example GmbH', boundingBox: box(10, 440) },
        {
          id: 'seller-street',
          text: 'Main Street 1',
          boundingBox: box(10, 430),
        },
        { id: 'seller-city', text: '10115 Berlin', boundingBox: box(10, 420) },
        { id: 'buyer', text: 'Buyer', boundingBox: box(300, 450) },
        { id: 'buyer-name', text: 'Customer AG', boundingBox: box(300, 440) },
        { id: 'buyer-street', text: 'Park 2', boundingBox: box(300, 430) },
        { id: 'buyer-city', text: '20095 Hamburg', boundingBox: box(300, 420) },
        { id: 'net', text: 'Net total 100,00 EUR', boundingBox: box(10, 100) },
        { id: 'tax', text: 'VAT 19,00 EUR 19%', boundingBox: box(10, 80) },
        {
          id: 'gross',
          text: 'Grand total 119,00 EUR',
          boundingBox: box(10, 60),
        },
      ]),
    )
    const draft = mapExtractionResultToDraft(result)

    expect(draft.number).toMatchObject({
      value: 'INV-42',
      status: 'extracted',
      source: { page: 1 },
    })
    expect(validateInvoiceDraft(draft)).toContainEqual(
      expect.objectContaining({
        path: 'number',
        message: 'Erkannter Wert muss bestätigt oder bearbeitet werden',
        severity: 'warning',
      }),
    )
    expect(draft.seller.name.value).toBe('Example GmbH')
    expect(draft.buyer.city.value).toBe('Hamburg')
    expect(draft.netTotalMinor.value).toBe(10000)
    expect(draft.vatBreakdown[0]).toMatchObject({
      rateBasisPoints: { value: 1900 },
    })
  })
})

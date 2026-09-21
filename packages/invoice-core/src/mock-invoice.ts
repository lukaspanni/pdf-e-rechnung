import { parseInvoice } from './index.ts'

export const mockInvoice = parseInvoice({
  number: 'RE-2026-0001',
  issueDate: '2026-03-20',
  deliveryDate: '2026-03-20',
  currency: 'EUR',
  seller: {
    name: 'Musterberatung GmbH',
    street: 'Hauptstraße 12',
    postalCode: '10115',
    city: 'Berlin',
    countryCode: 'DE',
    vatId: 'DE123456789',
  },
  buyer: {
    name: 'Beispielhandel GmbH',
    street: 'Marktstraße 5',
    postalCode: '20095',
    city: 'Hamburg',
    countryCode: 'DE',
  },
  lines: [
    {
      description: 'Beratungsleistung März 2026',
      quantity: 2,
      unitCode: 'HUR',
      unitPriceMinor: 12500,
      netAmountMinor: 25000,
      vatCategory: 'S',
      vatRateBasisPoints: 1900,
    },
    {
      description: 'Dokumentation',
      quantity: 1,
      unitCode: 'C62',
      unitPriceMinor: 5000,
      netAmountMinor: 5000,
      vatCategory: 'S',
      vatRateBasisPoints: 1900,
    },
  ],
  vatBreakdown: [
    {
      vatCategory: 'S',
      rateBasisPoints: 1900,
      taxableAmountMinor: 30000,
      taxAmountMinor: 5700,
    },
  ],
  netTotalMinor: 30000,
  taxTotalMinor: 5700,
  grossTotalMinor: 35700,
  payment: {
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    dueDate: '2026-04-03',
    reference: 'RE-2026-0001',
  },
})

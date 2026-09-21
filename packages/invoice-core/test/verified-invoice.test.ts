import { describe, expect, it } from 'vitest'
import { createInvoiceDraft, verifyInvoiceDraft } from '../src/index'
import { mockInvoice } from '../src/mock-invoice'

describe('verifyInvoiceDraft', () => {
  it('creates a verified invoice only from reviewer-resolved values', () => {
    const draft = createInvoiceDraft()
    const set = <T>(value: T) => ({ value, status: 'user-confirmed' as const })
    draft.number = set(mockInvoice.number)
    draft.issueDate = set(mockInvoice.issueDate)
    draft.deliveryDate = set(mockInvoice.deliveryDate)
    draft.currency = set(mockInvoice.currency)
    draft.seller = Object.fromEntries(
      Object.entries(mockInvoice.seller).map(([key, value]) => [
        key,
        set(value),
      ]),
    ) as typeof draft.seller
    draft.buyer = Object.fromEntries(
      Object.entries(mockInvoice.buyer).map(([key, value]) => [
        key,
        set(value),
      ]),
    ) as typeof draft.buyer
    draft.lines = mockInvoice.lines.map((line) => ({
      description: set(line.description),
      quantity: set(line.quantity),
      unitCode: set(line.unitCode),
      unitPriceMinor: set(line.unitPriceMinor),
      netAmountMinor: set(line.netAmountMinor),
      vatRateBasisPoints: set(line.vatRateBasisPoints),
    }))
    draft.vatBreakdown = mockInvoice.vatBreakdown.map((vat) => ({
      rateBasisPoints: set(vat.rateBasisPoints),
      taxableAmountMinor: set(vat.taxableAmountMinor),
      taxAmountMinor: set(vat.taxAmountMinor),
    }))
    draft.netTotalMinor = set(mockInvoice.netTotalMinor)
    draft.taxTotalMinor = set(mockInvoice.taxTotalMinor)
    draft.grossTotalMinor = set(mockInvoice.grossTotalMinor)
    draft.payment.iban = set(mockInvoice.payment.iban)
    draft.payment.bic = set(mockInvoice.payment.bic!)
    draft.payment.reference = set(mockInvoice.payment.reference!)
    draft.dueDate = set(mockInvoice.payment.dueDate!)

    expect(verifyInvoiceDraft(draft)).toEqual(mockInvoice)
  })

  it('rejects uncertain and incomplete fields', () => {
    const draft = createInvoiceDraft()
    draft.number = { value: 'INV-1', status: 'uncertain' }
    expect(() => verifyInvoiceDraft(draft)).toThrow()
  })
})

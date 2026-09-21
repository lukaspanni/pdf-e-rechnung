import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  createInvoiceDraft,
  editDraftField,
  formatMoney,
  invoiceSchema,
  validateInvoiceDraft,
} from '../src/index'
import { mockInvoice } from '../src/mock-invoice'

describe('invoice domain', () => {
  it('accepts the reusable German B2B fixture and formats integer money', () => {
    expect(invoiceSchema.safeParse(mockInvoice).success).toBe(true)
    expect(formatMoney(mockInvoice.grossTotalMinor)).toBe('357,00 €')
  })

  it('rejects inconsistent line and document totals', () => {
    const result = invoiceSchema.safeParse({
      ...mockInvoice,
      lines: [{ ...mockInvoice.lines[0], netAmountMinor: 1 }],
      netTotalMinor: 1,
      taxTotalMinor: 0,
      grossTotalMinor: 1,
      vatBreakdown: [
        { rateBasisPoints: 1900, taxableAmountMinor: 1, taxAmountMinor: 0 },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('requires a seller VAT ID and real calendar dates', () => {
    expect(
      invoiceSchema.safeParse({
        ...mockInvoice,
        seller: { ...mockInvoice.seller, vatId: '' },
      }).success,
    ).toBe(false)
    expect(
      invoiceSchema.safeParse({ ...mockInvoice, issueDate: '2026-02-30' })
        .success,
    ).toBe(false)
    expect(
      invoiceSchema.safeParse({ ...mockInvoice, issueDate: '2026-13-01' })
        .success,
    ).toBe(false)
    expect(
      invoiceSchema.safeParse({ ...mockInvoice, issueDate: '2026-00-01' })
        .success,
    ).toBe(false)
  })

  it('requires one non-duplicate VAT breakdown per line VAT group', () => {
    expect(
      invoiceSchema.safeParse({
        ...mockInvoice,
        vatBreakdown: [
          {
            vatCategory: 'Z',
            rateBasisPoints: 0,
            taxableAmountMinor: 0,
            taxAmountMinor: 0,
          },
        ],
        taxTotalMinor: 0,
        grossTotalMinor: mockInvoice.netTotalMinor,
      }).success,
    ).toBe(false)
    expect(
      invoiceSchema.safeParse({
        ...mockInvoice,
        vatBreakdown: [
          ...mockInvoice.vatBreakdown,
          mockInvoice.vatBreakdown[0],
        ],
        taxTotalMinor: mockInvoice.taxTotalMinor * 2,
        grossTotalMinor:
          mockInvoice.netTotalMinor + mockInvoice.taxTotalMinor * 2,
      }).success,
    ).toBe(false)
  })

  it('supports only valid standard-rated and zero-rated VAT combinations', () => {
    expect(
      invoiceSchema.safeParse({
        ...mockInvoice,
        lines: [
          {
            ...mockInvoice.lines[0],
            vatCategory: 'S',
            vatRateBasisPoints: 0,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      invoiceSchema.safeParse({
        ...mockInvoice,
        lines: [
          {
            ...mockInvoice.lines[0],
            vatCategory: 'Z',
            vatRateBasisPoints: 1900,
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('accepts valid mixed standard-rated and zero-rated invoice groups', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (standardNetMinor, zeroNetMinor) => {
          const standardTaxMinor = Math.round((standardNetMinor * 1900) / 10000)
          const netTotalMinor = standardNetMinor + zeroNetMinor
          return invoiceSchema.safeParse({
            ...mockInvoice,
            lines: [
              {
                ...mockInvoice.lines[0],
                quantity: 1,
                unitPriceMinor: standardNetMinor,
                netAmountMinor: standardNetMinor,
                vatCategory: 'S',
                vatRateBasisPoints: 1900,
              },
              {
                ...mockInvoice.lines[1],
                quantity: 1,
                unitPriceMinor: zeroNetMinor,
                netAmountMinor: zeroNetMinor,
                vatCategory: 'Z',
                vatRateBasisPoints: 0,
              },
            ],
            vatBreakdown: [
              {
                vatCategory: 'S',
                rateBasisPoints: 1900,
                taxableAmountMinor: standardNetMinor,
                taxAmountMinor: standardTaxMinor,
              },
              {
                vatCategory: 'Z',
                rateBasisPoints: 0,
                taxableAmountMinor: zeroNetMinor,
                taxAmountMinor: 0,
              },
            ],
            netTotalMinor,
            taxTotalMinor: standardTaxMinor,
            grossTotalMinor: netTotalMinor + standardTaxMinor,
          }).success
        },
      ),
    )
  })

  it('accepts decimal quantities with minor-unit rounded line totals', () => {
    const line = {
      ...mockInvoice.lines[0],
      quantity: 1.5,
      unitPriceMinor: 200,
      netAmountMinor: 300,
    }
    expect(
      invoiceSchema.safeParse({
        ...mockInvoice,
        lines: [line],
        vatBreakdown: [
          {
            vatCategory: line.vatCategory,
            rateBasisPoints: line.vatRateBasisPoints,
            taxableAmountMinor: 300,
            taxAmountMinor: 57,
          },
        ],
        netTotalMinor: 300,
        taxTotalMinor: 57,
        grossTotalMinor: 357,
      }).success,
    ).toBe(true)
  })

  it('keeps extraction evidence when a reviewer edits a draft field', () => {
    const draft = createInvoiceDraft()
    draft.number = {
      value: 'OCR-1',
      extractedValue: 'OCR-1',
      confidence: 'medium',
      status: 'uncertain',
      source: { page: 2, sourceText: 'Invoice OCR-1', sourceItemIds: ['2:3'] },
    }
    draft.number = editDraftField(draft.number, 'INV-1')

    expect(draft.number).toMatchObject({
      value: 'INV-1',
      extractedValue: 'OCR-1',
      status: 'user-edited',
      source: { page: 2, sourceItemIds: ['2:3'] },
    })
    expect(
      validateInvoiceDraft(draft).some((issue) => issue.severity === 'error'),
    ).toBe(true)
  })
})

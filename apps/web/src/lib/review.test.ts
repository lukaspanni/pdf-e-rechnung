import { describe, expect, it } from 'vitest'
import { createInvoiceDraft } from '@app/invoice-core'
import { buildReviewQueue } from './review'

describe('review queue', () => {
  it('orders missing required values before uncertain values and arithmetic issues', () => {
    const draft = createInvoiceDraft()
    draft.number = { value: 'INV-1', status: 'uncertain' }
    draft.issueDate = { value: '2026-01-01', status: 'extracted' }
    draft.buyer.name = { value: 'Buyer', status: 'extracted' }
    draft.netTotalMinor = { value: 100, status: 'extracted' }
    draft.taxTotalMinor = { value: 19, status: 'extracted' }
    draft.grossTotalMinor = { value: 100, status: 'extracted' }

    const queue = buildReviewQueue(draft)

    expect(queue.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'seller.name',
        'number',
        'issueDate',
        'buyer.name',
        'netTotalMinor',
        'taxTotalMinor',
        'grossTotalMinor',
      ]),
    )
  })

  it('includes extracted candidates until explicitly confirmed', () => {
    const draft = createInvoiceDraft()
    draft.number = { value: 'INV-1', status: 'extracted' }

    expect(buildReviewQueue(draft)).toContainEqual(
      expect.objectContaining({ path: 'number', priority: 1 }),
    )
  })
})

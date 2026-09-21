import { describe, expect, it } from 'vitest'
import { findSourceBoxes, pdfBoxToOverlay } from './pdf-source'

describe('PDF source coordinates', () => {
  it('converts PDF coordinates through the viewport into responsive percentages', () => {
    const viewport = {
      width: 1200,
      height: 1600,
      convertToViewportPoint: (x: number, y: number) => [x * 2, 1600 - y * 2],
    }

    expect(
      pdfBoxToOverlay({ x: 60, y: 160, width: 120, height: 40 }, viewport),
    ).toEqual({ left: 10, top: 75, width: 20, height: 5 })
  })

  it('looks up every source item on the source page', () => {
    const boxes = findSourceBoxes(
      {
        pages: [
          {
            number: 2,
            textItems: [
              {
                id: '2:1',
                text: 'Multi-line',
                boundingBox: { x: 10, y: 30, width: 40, height: 10 },
              },
              {
                id: '2:2',
                text: 'description',
                boundingBox: { x: 10, y: 20, width: 50, height: 10 },
              },
            ],
          },
        ],
      },
      { page: 2, sourceText: '', sourceItemIds: ['2:1', '2:2'] },
    )

    expect(boxes).toHaveLength(2)
  })
})

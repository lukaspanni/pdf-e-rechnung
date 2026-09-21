import type { FieldSource } from '@app/invoice-core'
import type { BoundingBox, DocumentModel } from '@app/pdf-core'

export type OverlayBox = {
  left: number
  top: number
  width: number
  height: number
}

type PdfViewport = {
  width: number
  height: number
  convertToViewportPoint: (x: number, y: number) => Array<number>
}

export interface PdfViewerController {
  scrollToSource: (source: FieldSource) => void
  highlightSources: (sources: Array<FieldSource>) => void
  clearHighlights: () => void
}

/** PDF coordinates -> rendered viewport pixels -> responsive overlay percentages. */
export function pdfBoxToOverlay(
  box: BoundingBox,
  viewport: PdfViewport,
): OverlayBox {
  const [x1, y1] = viewport.convertToViewportPoint(box.x, box.y)
  const [x2, y2] = viewport.convertToViewportPoint(
    box.x + box.width,
    box.y + box.height,
  )
  const left = Math.min(x1!, x2!)
  const top = Math.min(y1!, y2!)
  return {
    left: (left / viewport.width) * 100,
    top: (top / viewport.height) * 100,
    width: (Math.abs(x2! - x1!) / viewport.width) * 100,
    height: (Math.abs(y2! - y1!) / viewport.height) * 100,
  }
}

export function findSourceBoxes(
  document: DocumentModel,
  source: FieldSource,
): Array<BoundingBox> {
  const page = document.pages.find(
    (candidate) => candidate.number === source.page,
  )
  const ids = new Set(source.sourceItemIds)
  const boxes =
    page?.textItems
      .filter((item) => ids.has(item.id) && item.boundingBox)
      .map((item) => item.boundingBox!) ?? []
  return boxes.length ? boxes : source.boundingBox ? [source.boundingBox] : []
}

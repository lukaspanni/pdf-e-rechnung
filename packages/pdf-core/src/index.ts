export type BoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type DocumentTextItem = {
  id: string
  text: string
  boundingBox?: BoundingBox
}

export type DocumentPage = {
  number: number
  textItems: Array<DocumentTextItem>
}

/** Text and layout extracted from a digital PDF. Coordinates use the PDF page. */
export type DocumentModel = {
  pages: Array<DocumentPage>
  /** Original PDF bytes for extractors that need page rendering or vision. */
  sourcePdf?: Uint8Array
}

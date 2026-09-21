import type {
  BoundingBox,
  DocumentModel,
  DocumentPage,
  DocumentTextItem,
} from '@app/pdf-core'

export type ExtractionLine = {
  page: number
  items: ReadonlyArray<DocumentTextItem>
  text: string
  boundingBox?: BoundingBox
}

export type ExtractionBlock = {
  page: number
  lines: ReadonlyArray<ExtractionLine>
  text: string
  boundingBox?: BoundingBox
}

export type TableCandidate = {
  page: number
  rows: ReadonlyArray<ExtractionLine>
}

export type ExtractionContext = {
  document: DocumentModel
  sourcePdf: Uint8Array | undefined
  pages: ReadonlyArray<DocumentPage>
  readonly normalizedText: string
  readonly lines: ReadonlyArray<ExtractionLine>
  readonly blocks: ReadonlyArray<ExtractionBlock>
  readonly tables: ReadonlyArray<TableCandidate>
  readonly itemsByNormalizedText: ReadonlyMap<
    string,
    ReadonlyArray<DocumentTextItem>
  >
  readonly itemsById: ReadonlyMap<string, DocumentTextItem>
}

function unionBoxes(
  boxes: ReadonlyArray<BoundingBox>,
): BoundingBox | undefined {
  if (boxes.length === 0) return undefined
  const left = Math.min(...boxes.map((box) => box.x))
  const bottom = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const top = Math.max(...boxes.map((box) => box.y + box.height))
  return { x: left, y: bottom, width: right - left, height: top - bottom }
}

function groupLines(page: DocumentPage): Array<ExtractionLine> {
  const sorted = page.textItems
    .filter((item) => item.boundingBox)
    .sort(
      (a, b) =>
        b.boundingBox!.y - a.boundingBox!.y ||
        a.boundingBox!.x - b.boundingBox!.x,
    )
  const rows: Array<Array<DocumentTextItem>> = []
  for (const item of sorted) {
    const row = rows.find(
      (candidate) =>
        Math.abs(candidate[0]!.boundingBox!.y - item.boundingBox!.y) <= 4,
    )
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.map((items) => {
    const ordered = items.sort((a, b) => a.boundingBox!.x - b.boundingBox!.x)
    const boundingBox = unionBoxes(
      ordered.flatMap((item) => (item.boundingBox ? [item.boundingBox] : [])),
    )
    return {
      page: page.number,
      items: ordered,
      text: ordered
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(' '),
      ...(boundingBox ? { boundingBox } : {}),
    }
  })
}

function groupBlocks(
  lines: ReadonlyArray<ExtractionLine>,
): Array<ExtractionBlock> {
  const blocks: Array<Array<ExtractionLine>> = []
  for (const line of lines) {
    const previous = blocks.at(-1)?.at(-1)
    if (
      previous?.boundingBox &&
      line.boundingBox &&
      previous.page === line.page &&
      previous.boundingBox.y - line.boundingBox.y <= 18 &&
      Math.abs(previous.boundingBox.x - line.boundingBox.x) <= 80
    ) {
      blocks.at(-1)!.push(line)
    } else {
      blocks.push([line])
    }
  }
  return blocks.map((blockLines) => {
    const boundingBox = unionBoxes(
      blockLines.flatMap((line) => line.boundingBox ?? []),
    )
    return {
      page: blockLines[0]!.page,
      lines: blockLines,
      text: blockLines.map((line) => line.text).join('\n'),
      ...(boundingBox ? { boundingBox } : {}),
    }
  })
}

function findTables(
  lines: ReadonlyArray<ExtractionLine>,
): Array<TableCandidate> {
  const pages = new Map<number, Array<ExtractionLine>>()
  for (const line of lines) {
    const pageLines = pages.get(line.page) ?? []
    pageLines.push(line)
    pages.set(line.page, pageLines)
  }
  return [...pages].flatMap(([page, pageLines]) => {
    const rows = pageLines.filter(
      (line) => line.items.length >= 2 && /\d/.test(line.text),
    )
    return rows.length >= 2 ? [{ page, rows }] : []
  })
}

export function createExtractionContext(
  document: DocumentModel,
): ExtractionContext {
  let lines: Array<ExtractionLine> | undefined
  let blocks: Array<ExtractionBlock> | undefined
  let tables: Array<TableCandidate> | undefined
  let normalizedText: string | undefined
  let textIndex: Map<string, Array<DocumentTextItem>> | undefined
  let idIndex: Map<string, DocumentTextItem> | undefined
  let textIndexReady = false

  const context: ExtractionContext = {
    document,
    sourcePdf: document.sourcePdf,
    pages: document.pages,
    get normalizedText() {
      normalizedText ??= document.pages
        .flatMap((page) => page.textItems.map((item) => item.text))
        .join('\n')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
      return normalizedText
    },
    get lines() {
      lines ??= document.pages.flatMap(groupLines)
      return lines
    },
    get blocks() {
      blocks ??= groupBlocks(context.lines)
      return blocks
    },
    get tables() {
      tables ??= findTables(context.lines)
      return tables
    },
    get itemsByNormalizedText() {
      textIndex ??= new Map<string, Array<DocumentTextItem>>()
      if (!textIndexReady) {
        for (const page of document.pages)
          for (const item of page.textItems) {
            const key = item.text.normalize('NFKC').toLocaleLowerCase().trim()
            const matching = textIndex.get(key) ?? []
            matching.push(item)
            textIndex.set(key, matching)
          }
        textIndexReady = true
      }
      return textIndex
    },
    get itemsById() {
      idIndex ??= new Map(
        document.pages.flatMap((page) =>
          page.textItems.map((item) => [item.id, item] as const),
        ),
      )
      return idIndex
    },
  }
  return context
}

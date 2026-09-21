import { createExtractionContext } from './context'
import type {
  DocumentModel,
  DocumentPage,
  DocumentTextItem,
} from '@app/pdf-core'
import type { ExtractionContext } from './context'
import type { ExtractedValue } from './contracts'

const labelPattern = /\b(?:payment\s*terms?|zahlungs(?:bedingungen|ziel))\b/i
const prosePattern =
  /\b(?:(?:zahlbar\s+)?innerhalb\s+von\s+\d{1,3}\s+(?:kalender)?tagen(?:\s+ohne\s+abzug)?|(?:payable\s+)?within\s+\d{1,3}\s+(?:calendar\s+)?days?(?:\s+without\s+deduction)?)\b/gi

function candidate(
  value: string,
  page: number,
  sourceText: string,
  sourceItems: ReadonlyArray<DocumentTextItem>,
  label?: string,
): ExtractedValue<string> {
  const boxes = sourceItems.flatMap((item) =>
    item.boundingBox ? [item.boundingBox] : [],
  )
  const boundingBox = boxes.length
    ? {
        x: Math.min(...boxes.map((box) => box.x)),
        y: Math.min(...boxes.map((box) => box.y)),
        width:
          Math.max(...boxes.map((box) => box.x + box.width)) -
          Math.min(...boxes.map((box) => box.x)),
        height:
          Math.max(...boxes.map((box) => box.y + box.height)) -
          Math.min(...boxes.map((box) => box.y)),
      }
    : undefined
  return {
    value,
    certainty: label ? 'high' : 'medium',
    page,
    sourceText,
    sourceItemIds: sourceItems.map((item) => item.id),
    ...(label ? { label } : {}),
    ...(boundingBox ? { boundingBox } : {}),
  }
}

function unique(candidates: Array<ExtractedValue<string>>) {
  const found = new Map<string, ExtractedValue<string>>()
  for (const item of candidates) {
    const previous = found.get(item.value)
    if (!previous || item.certainty === 'high') found.set(item.value, item)
  }
  return [...found.values()]
}

function labelledTerms(pages: ReadonlyArray<DocumentPage>) {
  return pages.flatMap((page) =>
    page.textItems.flatMap((item, index) => {
      if (!labelPattern.test(item.text)) return []
      const inlineValue = item.text
        .replace(labelPattern, '')
        .replace(/^[\s:#.-]+/, '')
        .trim()
      const next = page.textItems[index + 1]
      const value = inlineValue || next?.text.trim()
      if (!value) return []
      return [
        candidate(
          value,
          page.number,
          [item.text, ...(inlineValue || !next ? [] : [next.text])].join(' '),
          inlineValue || !next ? [item] : [item, next],
          item.text,
        ),
      ]
    }),
  )
}

function proseFromRows(
  rows: ReadonlyArray<{
    page: number
    text: string
    items: ReadonlyArray<DocumentTextItem>
  }>,
) {
  return rows.flatMap((row) => {
    prosePattern.lastIndex = 0
    return [...row.text.matchAll(prosePattern)].map((match) =>
      candidate(match[0], row.page, row.text, row.items),
    )
  })
}

export function extractPaymentTerms(
  input: ExtractionContext | DocumentModel,
): Array<ExtractedValue<string>> {
  const context = 'document' in input ? input : createExtractionContext(input)
  const lineCandidates = proseFromRows(context.lines)
  const blockCandidates = proseFromRows(
    context.blocks.map((block) => ({
      page: block.page,
      text: block.text,
      items: block.lines.flatMap((line) => line.items),
    })),
  )
  return unique([
    ...labelledTerms(context.pages),
    ...lineCandidates,
    ...blockCandidates,
  ])
}

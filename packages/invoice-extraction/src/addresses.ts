import type { DocumentPage, DocumentTextItem } from '@app/pdf-core'
import type { ExtractionContext } from './context'
import type { ExtractedValue } from './contracts'

const labels = {
  seller:
    /\b(?:seller|supplier|vendor|verkäufer|lieferant|rechnungssteller)\b/i,
  buyer: /\b(?:buyer|bill\s*to|customer|kunde|rechnungsempfänger)\b/i,
}

function candidate<T>(
  value: T,
  page: DocumentPage,
  item: DocumentTextItem,
): ExtractedValue<T> {
  return {
    value,
    certainty: 'medium',
    page: page.number,
    sourceText: item.text,
    sourceItemIds: [item.id],
    ...(item.boundingBox ? { boundingBox: item.boundingBox } : {}),
  }
}

function labelledAddressBlocks(
  pages: ReadonlyArray<DocumentPage>,
  pattern: RegExp,
): Array<ExtractedValue<Array<string>>> {
  return pages.flatMap((page) =>
    page.textItems.flatMap((item) => {
      if (!pattern.test(item.text) || !item.boundingBox) return []
      const blockItems = page.textItems
        .filter(
          (next) =>
            next.boundingBox &&
            next.id !== item.id &&
            next.boundingBox.y < item.boundingBox!.y &&
            item.boundingBox!.y - next.boundingBox.y <= 105 &&
            Math.abs(next.boundingBox.x - item.boundingBox!.x) < 140,
        )
        .sort((a, b) => b.boundingBox!.y - a.boundingBox!.y)
        .slice(0, 6)
        .filter(
          (next) => Math.abs(next.boundingBox!.x - item.boundingBox!.x) < 140,
        )
      const postalIndex = blockItems.findIndex((next) =>
        /^\d{4,6}\s+[\p{L}]/u.test(next.text.trim()),
      )
      if (postalIndex < 2) return []
      const name = blockItems[0]
      const postalCity = blockItems[postalIndex]
      const streetItems = blockItems.slice(1, postalIndex)
      const street = streetItems[0]
      if (
        !name ||
        !street ||
        !postalCity ||
        /\d/.test(name.text) ||
        !/\p{L}[\p{L}\p{M}.'’-]*(?:\s+\p{L}[\p{L}\p{M}.'’-]*)*\s+\d+[a-z]?$/iu.test(
          street.text.trim(),
        ) ||
        !/^\d{4,6}\s+[\p{L}].+$/u.test(postalCity.text.trim())
      )
        return []
      return [
        {
          ...candidate(
            [
              name.text.trim(),
              ...streetItems.map((line) => line.text.trim()),
              postalCity.text.trim(),
            ],
            page,
            item,
          ),
          sourceItemIds: [
            name.id,
            ...streetItems.map((line) => line.id),
            postalCity.id,
          ],
          label: item.text,
        },
      ]
    }),
  )
}

function unlabelledAddressBlocks(
  pages: ReadonlyArray<DocumentPage>,
): Array<ExtractedValue<Array<string>>> {
  return pages.flatMap((page) => {
    const items = page.textItems
      .filter((item) => item.boundingBox && item.text.trim())
      .sort(
        (a, b) =>
          b.boundingBox!.y - a.boundingBox!.y ||
          a.boundingBox!.x - b.boundingBox!.x,
      )
    const blocks: Array<ExtractedValue<Array<string>>> = []
    for (const name of items) {
      const nameText = name.text.trim()
      if (nameText.length < 4 || /\d/.test(nameText)) continue
      const nextLine = (previous: DocumentTextItem) =>
        items
          .filter(
            (item) =>
              item.boundingBox!.y < previous.boundingBox!.y &&
              previous.boundingBox!.y - item.boundingBox!.y <= 24 &&
              Math.abs(item.boundingBox!.x - name.boundingBox!.x) <= 24,
          )
          .sort(
            (a, b) =>
              previous.boundingBox!.y -
              a.boundingBox!.y -
              (previous.boundingBox!.y - b.boundingBox!.y),
          )[0]
      const firstStreet = nextLine(name)
      if (!firstStreet) continue
      const following = [firstStreet]
      while (following.length < 4) {
        const previous = following.at(-1)!
        const next = nextLine(previous)
        if (!next || following.some((line) => line.id === next.id)) break
        following.push(next)
        if (/^\d{4,6}\s+[\p{L}]/u.test(next.text.trim())) break
      }
      const postalCity = following.find((line) =>
        /^\d{4,6}\s+[\p{L}]/u.test(line.text.trim()),
      )
      const postalIndex = postalCity ? following.indexOf(postalCity) : -1
      const streetLines = postalIndex > 0 ? following.slice(0, postalIndex) : []
      const street = streetLines[0]
      if (!street || !postalCity) continue
      if (name.boundingBox!.y - postalCity.boundingBox!.y > 80) continue
      const postalCityText = postalCity.text.trim()
      if (
        !/^\p{L}[\p{L}\p{M}.'’-]*(?:\s+\p{L}[\p{L}\p{M}.'’-]*)*\s+\d+[a-z]?$/iu.test(
          street.text.trim(),
        ) ||
        !/^\d{4,6}\s+[\p{L}].+$/u.test(postalCityText)
      )
        continue
      blocks.push({
        ...candidate(
          [
            nameText,
            ...streetLines.map((line) => line.text.trim()),
            postalCityText,
          ],
          page,
          name,
        ),
        sourceItemIds: [
          name.id,
          ...streetLines.map((line) => line.id),
          postalCity.id,
        ],
      })
    }
    return blocks
  })
}

function oneLineSenderAddress(
  page: DocumentPage | undefined,
  recipientBlocks: Array<ExtractedValue<Array<string>>>,
): Array<ExtractedValue<Array<string>>> {
  if (!page) return []
  const items = page.textItems
    .filter((item) => item.boundingBox && item.text.trim())
    .sort(
      (a, b) =>
        b.boundingBox!.y - a.boundingBox!.y ||
        a.boundingBox!.x - b.boundingBox!.x,
    )
  const first = items[0]
  if (!first?.boundingBox) return []
  const sameLine = items
    .filter((item) => Math.abs(item.boundingBox!.y - first.boundingBox!.y) <= 2)
    .sort((a, b) => a.boundingBox!.x - b.boundingBox!.x)
  const row = [first]
  for (const item of sameLine.slice(1)) {
    const previous = row.at(-1)!
    const gap =
      item.boundingBox!.x -
      (previous.boundingBox!.x + previous.boundingBox!.width)
    if (gap > 28) break
    row.push(item)
  }
  const text = row.map((item) => item.text.trim()).join(' ')
  const parts = text
    .split(/\s*(?:[•·|,])\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 3) return []
  const [name, street, postalCity, ...extra] = parts
  if (
    !name ||
    !street ||
    !postalCity ||
    extra.length > 0 ||
    /\d/.test(name) ||
    !/^\p{L}[\p{L}\p{M}.'’-]*(?:\s+\p{L}[\p{L}\p{M}.'’-]*)*\s+\d+[a-z]?$/iu.test(
      street,
    )
  )
    return []

  const postalMatch = postalCity.match(/^(\d{5})(?:\s+([\p{L}].+))?$/u)
  if (!postalMatch?.[1]) return []
  let city = postalMatch[2]?.trim()
  const sourceIds = row.map((item) => item.id)
  if (!city) {
    const continuation = items.find(
      (item) =>
        item.boundingBox!.y < first.boundingBox!.y &&
        first.boundingBox!.y - item.boundingBox!.y <= 24 &&
        /^\p{L}[\p{L}\p{M}.'’-]*(?:\s+[\p{L}\p{M}.'’-]+)*$/u.test(
          item.text.trim(),
        ),
    )
    if (!continuation) return []
    city = continuation.text.trim()
    sourceIds.push(continuation.id)
  }

  const recipientBelow = recipientBlocks.some(
    (block) =>
      block.page === page.number &&
      block.boundingBox &&
      block.boundingBox.y < first.boundingBox!.y,
  )
  return recipientBelow
    ? [
        {
          ...candidate(
            [name, street, `${postalMatch[1]} ${city}`],
            page,
            first,
          ),
          sourceItemIds: sourceIds,
        },
      ]
    : []
}

export function extractAddressBlocks(context: ExtractionContext) {
  const pages = context.pages
  const buyer = labelledAddressBlocks(pages, labels.buyer)
  const seller = [
    ...labelledAddressBlocks(pages, labels.seller),
    ...oneLineSenderAddress(pages[0], [
      ...buyer,
      ...unlabelledAddressBlocks(pages),
    ]),
  ]
  const explicitIds = new Set(
    [...seller, ...buyer].flatMap((block) => block.sourceItemIds),
  )
  const generic = unlabelledAddressBlocks(pages).filter(
    (block) => !block.sourceItemIds.some((id) => explicitIds.has(id)),
  )
  const ordered = generic.sort(
    (a, b) =>
      (b.boundingBox?.y ?? 0) - (a.boundingBox?.y ?? 0) ||
      (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0),
  )
  if (!seller.length && !buyer.length) {
    if (ordered.length >= 2)
      return { seller: ordered.slice(0, 1), buyer: ordered.slice(1, 2) }
    return { seller, buyer: ordered }
  }
  return {
    seller: seller.length ? seller : ordered.slice(0, 1),
    buyer: buyer.length
      ? buyer
      : ordered.slice(seller.length ? 0 : 1, seller.length ? 1 : 2),
  }
}

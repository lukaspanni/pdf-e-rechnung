import type { BoundingBox, DocumentPage, DocumentTextItem } from '@app/pdf-core'
import type { ExtractionContext } from './context'

export type ExtractionCertainty = 'low' | 'medium' | 'high'
export type ExtractedValue<T> = {
  value: T
  certainty: ExtractionCertainty
  page: number
  sourceText: string
  sourceItemIds: Array<string>
  boundingBox?: BoundingBox
  label?: string
  labelDistance?: number
}
export type ExtractedLine = {
  description: string
  quantity?: number
  unitCode?: string
  unitPriceMinor?: number
  netAmountMinor?: number
  vatRateBasisPoints?: number
}

export type LineItemHeaderRole =
  | 'description'
  | 'quantity'
  | 'unit'
  | 'unitPrice'
  | 'lineTotal'
  | 'vatRate'
  | 'position'

export type LineItemHeaderProfile = {
  id: string
  kind: 'quantity-price' | 'line-total'
  headers: Partial<Record<LineItemHeaderRole, ReadonlyArray<string>>>
}

export type LineItemExtractionOptions = {
  /** Custom aliases are added after the built-in English, German, and compact profiles. */
  headerProfiles?: ReadonlyArray<LineItemHeaderProfile>
  /** Try column inference when no configured header profile matches a page. */
  includeHeaderless?: boolean
}

export const defaultLineItemHeaderProfiles: ReadonlyArray<LineItemHeaderProfile> =
  [
    {
      id: 'english-standard',
      kind: 'quantity-price',
      headers: {
        description: ['description', 'item description', 'product', 'service'],
        quantity: ['quantity', 'qty', 'count'],
        unit: ['unit', 'uom'],
        unitPrice: ['unit price', 'price per unit', 'rate'],
        lineTotal: ['line total', 'amount', 'total'],
        vatRate: ['vat', 'vat rate', 'tax rate'],
        position: ['no', 'item no', 'position'],
      },
    },
    {
      id: 'german-standard',
      kind: 'quantity-price',
      headers: {
        description: ['beschreibung', 'bezeichnung', 'artikel', 'leistung'],
        quantity: ['menge', 'anzahl', 'stück', 'stk'],
        unit: ['einheit', 'einheiten'],
        unitPrice: ['einzelpreis', 'preis je einheit', 'preis pro einheit'],
        lineTotal: ['gesamtpreis', 'positionsbetrag', 'betrag', 'gesamt'],
        vatRate: ['mwst', 'ust', 'mwst satz', 'ust satz', 'steuersatz'],
        position: ['pos', 'pos nr', 'position'],
      },
    },
    {
      id: 'compact-price',
      kind: 'line-total',
      headers: {
        description: [
          'description',
          'item description',
          'product',
          'service',
          'beschreibung',
          'bezeichnung',
          'artikel',
          'leistung',
        ],
        quantity: ['quantity', 'qty', 'menge', 'anzahl'],
        lineTotal: [
          'price',
          'preis',
          'amount',
          'betrag',
          'line total',
          'gesamt',
        ],
        vatRate: ['vat', 'mwst', 'ust', 'tax rate', 'steuersatz'],
        position: ['pos', 'pos nr', 'no', 'position'],
      },
    },
  ]

const normalizeHeader = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

function matchProfile(
  row: Array<DocumentTextItem>,
  profile: LineItemHeaderProfile,
): Map<LineItemHeaderRole, DocumentTextItem> | null {
  const found = new Map<LineItemHeaderRole, DocumentTextItem>()
  for (const [role, aliases] of Object.entries(profile.headers) as Array<
    [LineItemHeaderRole, ReadonlyArray<string>]
  >) {
    const normalizedAliases = new Set(aliases.map(normalizeHeader))
    const match = row.find((item) =>
      normalizedAliases.has(normalizeHeader(item.text)),
    )
    if (match) found.set(role, match)
  }
  if (!found.has('description')) return null
  if (
    profile.kind === 'quantity-price' &&
    (!found.has('quantity') || !found.has('unitPrice'))
  )
    return null
  if (profile.kind === 'line-total' && !found.has('lineTotal')) return null
  return found
}

function nearestRole(
  item: DocumentTextItem,
  headers: Map<LineItemHeaderRole, DocumentTextItem>,
  roles: ReadonlyArray<LineItemHeaderRole>,
) {
  const x = item.boundingBox!.x
  return roles
    .flatMap((role) => {
      const header = headers.get(role)
      if (!header?.boundingBox) return []
      const distance = Math.abs(x - header.boundingBox.x)
      return distance <= 85 ? [{ role, distance }] : []
    })
    .sort((a, b) => a.distance - b.distance)[0]?.role
}

function cellText(
  row: Array<DocumentTextItem>,
  role: LineItemHeaderRole,
  headers: Map<LineItemHeaderRole, DocumentTextItem>,
  roles: ReadonlyArray<LineItemHeaderRole>,
) {
  return row
    .filter((item) => nearestRole(item, headers, roles) === role)
    .sort((a, b) => a.boundingBox!.x - b.boundingBox!.x)
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

function amountMinor(text: string): number | null {
  const tokens = text.match(/\d[\d.,]*/g) ?? []
  for (const token of tokens) {
    const minor = parseAmount(token)
    if (minor !== null) return minor
  }
  return null
}

function parseAmount(value: string): number | null {
  const compact = value.replace(/\s/g, '')
  if (!/^\d+(?:[.,]\d+)*$/.test(compact)) return null
  const separators = [...compact.matchAll(/[.,]/g)]
  const last = separators.at(-1)?.index ?? -1
  const decimals = compact.length - last - 1
  if (last >= 0 && decimals !== 2 && decimals !== 3) return null
  const hasDecimal = last >= 0 && decimals === 2
  const whole = (hasDecimal ? compact.slice(0, last) : compact).replace(
    /[.,]/g,
    '',
  )
  const grouped = hasDecimal ? compact.slice(0, last) : compact
  if (/[.,]/.test(grouped) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(grouped))
    return null
  const fraction = hasDecimal ? compact.slice(last + 1) : ''
  const amount = Number(`${whole}${fraction.padEnd(2, '0')}`)
  return Number.isSafeInteger(amount) ? amount : null
}

function quantityValue(value: string): number | null {
  const text = value.replace(/\s/g, '')
  if (!/^\d+(?:[.,]\d+)*$/.test(text)) return null
  const decimal = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'))
  const normalized =
    decimal < 0
      ? text
      : `${text.slice(0, decimal).replace(/[.,]/g, '')}.${text.slice(decimal + 1)}`
  const quantity = Number(normalized)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null
}

function taxBasisPoints(value: string): number | undefined {
  const match = value.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/)
  if (!match?.[1]) return undefined
  const rate = Number(match[1].replace(',', '.'))
  return Number.isFinite(rate) && rate >= 0 && rate <= 100
    ? Math.round(rate * 100)
    : undefined
}

function sourceValue(
  value: ExtractedLine,
  page: DocumentPage,
  items: Array<DocumentTextItem>,
  certainty: ExtractionCertainty = 'medium',
): ExtractedValue<ExtractedLine> {
  const boxes = items.flatMap((item) =>
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
    certainty,
    page: page.number,
    sourceText: items.map((item) => item.text).join(' '),
    sourceItemIds: items.map((item) => item.id),
    ...(boundingBox ? { boundingBox } : {}),
  }
}

function extractProfileRows(
  page: DocumentPage,
  context: ExtractionContext,
  header: Map<LineItemHeaderRole, DocumentTextItem>,
  profile: LineItemHeaderProfile,
  headerPage = page.number,
): Array<ExtractedValue<ExtractedLine>> {
  const descriptionHeader = header.get('description')!
  const roles = [...header.keys()]
  const dataRows = context.lines.flatMap((line) => {
    const y = Math.max(
      ...line.items.flatMap((item) =>
        item.boundingBox ? [item.boundingBox.y] : [],
      ),
    )
    return line.page === page.number &&
      line.boundingBox &&
      (page.number !== headerPage ||
        (y < descriptionHeader.boundingBox!.y - 5 &&
          descriptionHeader.boundingBox!.y - y < 300))
      ? [{ y, items: [...line.items] }]
      : []
  })
  const cells = dataRows.map((row) => {
    const text = cellText(row.items, 'description', header, roles)
    const unitPrice = amountMinor(
      cellText(row.items, 'unitPrice', header, roles),
    )
    const lineTotal = amountMinor(
      cellText(row.items, 'lineTotal', header, roles),
    )
    const quantity = quantityValue(
      cellText(row.items, 'quantity', header, roles),
    )
    const money =
      profile.kind === 'line-total' ? lineTotal : (lineTotal ?? unitPrice)
    return { ...row, text, unitPrice, lineTotal, quantity, money }
  })
  const moneyRows = cells.filter((row) => row.money !== null)
  return moneyRows.flatMap((row, index) => {
    const next = moneyRows[index + 1]
    const continuation = cells.filter(
      (candidate) =>
        candidate.y < row.y &&
        (!next || candidate.y > next.y) &&
        candidate.money === null &&
        candidate.text &&
        row.y - candidate.y <= 36,
    )
    const description = [row.text, ...continuation.map((item) => item.text)]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (
      !description ||
      /^(?:\d+[.)]?)$/.test(description) ||
      /^(?:summe|gesamt|subtotal|total|steuer|mwst|ust)\b/i.test(description)
    )
      return []
    const quantity =
      row.quantity ?? (profile.kind === 'line-total' ? 1 : undefined)
    const net =
      row.lineTotal ?? (profile.kind === 'line-total' ? row.money : undefined)
    const unitPrice =
      row.unitPrice ??
      (profile.kind === 'line-total' && quantity
        ? Math.round(row.money! / quantity)
        : undefined)
    const sourceItems = [
      ...row.items,
      ...continuation.flatMap((item) => item.items),
    ]
    const tax = taxBasisPoints(cellText(row.items, 'vatRate', header, roles))
    return [
      sourceValue(
        {
          description,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(unitPrice !== undefined ? { unitPriceMinor: unitPrice } : {}),
          ...(net !== undefined && net !== null
            ? { netAmountMinor: net }
            : row.unitPrice !== null && quantity !== undefined
              ? { netAmountMinor: Math.round(row.unitPrice * quantity) }
              : {}),
          ...(tax !== undefined ? { vatRateBasisPoints: tax } : {}),
        },
        page,
        sourceItems,
      ),
    ]
  })
}

function extractHeaderlessRows(
  page: DocumentPage,
  context: ExtractionContext,
): Array<ExtractedValue<ExtractedLine>> {
  const rows = context.lines
    .filter((line) => line.page === page.number)
    .map((line) => ({
      y: Math.max(
        ...line.items.flatMap((item) =>
          item.boundingBox ? [item.boundingBox.y] : [0],
        ),
      ),
      items: [...line.items],
    }))
  const moneyByRow = rows.map((row) => ({
    ...row,
    moneyItems: row.items.filter((item) =>
      /(?:€|\$|£|\b(?:EUR|USD|GBP|CHF)\b|[.,]\d{2})/i.test(item.text),
    ),
  }))
  const clusters = new Map<
    number,
    { count: number; items: Array<DocumentTextItem> }
  >()
  for (const row of moneyByRow)
    for (const item of row.moneyItems) {
      const x = Math.round(item.boundingBox!.x / 24) * 24
      const cluster = clusters.get(x) ?? { count: 0, items: [] }
      cluster.count += 1
      cluster.items.push(item)
      clusters.set(x, cluster)
    }
  const column = [...clusters.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  )[0]
  if (!column || column[1].count < 2) return []
  const columnX = column[0]
  const candidates = moneyByRow.flatMap((row) => {
    const moneyItem = row.moneyItems.find(
      (item) => Math.abs(item.boundingBox!.x - columnX) <= 24,
    )
    if (!moneyItem || amountMinor(moneyItem.text) === null) return []
    const descriptions = row.items.filter(
      (item) =>
        item.boundingBox!.x < moneyItem.boundingBox!.x - 45 &&
        !row.moneyItems.includes(item) &&
        /\p{L}/u.test(item.text),
    )
    const description = descriptions
      .sort((a, b) => a.boundingBox!.x - b.boundingBox!.x)
      .map((item) => item.text.trim())
      .join(' ')
      .trim()
    return description ? [{ ...row, moneyItem, descriptions, description }] : []
  })
  return candidates.map((row, index) => {
    const next = candidates[index + 1]
    const continuation = rows.flatMap((candidate) =>
      candidate.y < row.y &&
      (!next || candidate.y > next.y) &&
      row.y - candidate.y <= 36
        ? candidate.items.filter(
            (item) =>
              item.boundingBox!.x < columnX - 45 &&
              /\p{L}/u.test(item.text) &&
              !moneyByRow
                .find((entry) => entry.y === candidate.y)
                ?.moneyItems.includes(item),
          )
        : [],
    )
    const description = [
      row.description,
      ...continuation.map((item) => item.text.trim()),
    ]
      .filter(Boolean)
      .join(' ')
      .trim()
    const amount = amountMinor(row.moneyItem.text)!
    return sourceValue(
      {
        description,
        quantity: 1,
        unitPriceMinor: amount,
        netAmountMinor: amount,
      },
      page,
      [...row.items, ...continuation],
      'low',
    )
  })
}

export function extractTableLines(
  context: ExtractionContext,
  options: LineItemExtractionOptions = {},
): Array<ExtractedValue<ExtractedLine>> {
  const pages: ReadonlyArray<DocumentPage> = context.pages
  const profiles = [
    ...defaultLineItemHeaderProfiles,
    ...(options.headerProfiles ?? []),
  ]
  let inherited:
    | {
        profile: LineItemHeaderProfile
        headers: Map<LineItemHeaderRole, DocumentTextItem>
        headerPage: number
      }
    | undefined
  const continuedHeaderPages = new Set<number>()
  const extracted = pages.flatMap((page) => {
    const headers = context.lines
      .filter((line) => line.page === page.number)
      .map((line) => [...line.items])
    const matched = headers.flatMap((row) =>
      profiles.flatMap((profile) => {
        const match = matchProfile(row, profile)
        return match ? [{ profile, match, size: match.size }] : []
      }),
    )
    const best = matched.sort((a, b) => b.size - a.size)[0]
    if (best) {
      inherited = {
        profile: best.profile,
        headers: best.match,
        headerPage: page.number,
      }
      const lines = extractProfileRows(
        page,
        context,
        best.match,
        best.profile,
        page.number,
      )
      if (continuedHeaderPages.has(page.number)) {
        const headerY = Math.max(
          ...[...best.match.values()].flatMap((item) =>
            item.boundingBox ? [item.boundingBox.y] : [],
          ),
        )
        const firstRowY = Math.max(
          ...context.lines
            .filter((line) => line.page === page.number && line.boundingBox)
            .flatMap((line) => (line.boundingBox ? [line.boundingBox.y] : [])),
        )
        const filtered = lines.filter((line) => {
          const source = context.itemsById.get(line.sourceItemIds[0] ?? '')
          return (
            !source?.boundingBox ||
            source.boundingBox.y < firstRowY - 1 ||
            headerY < firstRowY
          )
        })
        if (filtered.length || options.includeHeaderless === false)
          return filtered
      }
      if (lines.length || options.includeHeaderless === false) return lines
    }
    if (inherited) {
      const pageRows = context.lines.filter((line) => line.page === page.number)
      const repeated = pageRows.find((line) =>
        matchProfile([...line.items], inherited!.profile),
      )
      if (repeated) continuedHeaderPages.add(page.number)
      const lines = extractProfileRows(
        page,
        context,
        repeated
          ? matchProfile([...repeated.items], inherited.profile)!
          : inherited.headers,
        inherited.profile,
        inherited.headerPage,
      )
      if (lines.length) return lines
    }
    return options.includeHeaderless === false
      ? []
      : extractHeaderlessRows(page, context)
  })
  // Page breaks can split one description from its numeric row. Attach the
  // trailing text-only block to the first row on the next page when aligned.
  for (let index = 0; index < extracted.length - 1; index++) {
    const current = extracted[index]!
    const next = extracted[index + 1]!
    if (next.page <= current.page || current.value.description.endsWith(' '))
      continue
    const nextPage = pages.find((page) => page.number === next.page)
    const firstRow =
      nextPage &&
      context.lines
        .filter((line) => line.page === next.page)
        .sort((a, b) => (b.boundingBox?.y ?? 0) - (a.boundingBox?.y ?? 0))[0]
    if (!firstRow || !/\p{L}/u.test(firstRow.text)) continue
    if (next.value.description.startsWith(firstRow.text)) {
      current.value.description =
        `${current.value.description} ${firstRow.text}`.trim()
      current.sourceText = `${current.sourceText} ${firstRow.text}`.trim()
      current.sourceItemIds = [
        ...current.sourceItemIds,
        ...firstRow.items.map((item) => item.id),
      ]
    }
  }
  return extracted
}

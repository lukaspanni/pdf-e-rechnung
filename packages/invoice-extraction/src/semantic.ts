import { mapExtractionResultToDraft } from './draft'
import type { DocumentModel } from '@app/pdf-core'
import type { DraftField, InvoiceDraft } from '@app/invoice-core'
import type { ExtractionPlugin, ExtractionRunResult } from './contracts'

export type SemanticTextBlock = {
  id: string
  text: string
  pageNumber: number
  boundingBox?: { x: number; y: number; width: number; height: number }
  detectedLabels: Array<string>
}

export type SemanticPage = {
  pageNumber: number
  textBlocks: Array<SemanticTextBlock>
}
export type SemanticDocument = {
  pages: Array<SemanticPage>
  deterministicExtraction: InvoiceDraft
}

const semanticFieldPaths = [
  'number',
  'issueDate',
  'deliveryDate',
  'dueDate',
  'currency',
  'seller.name',
  'seller.street',
  'seller.postalCode',
  'seller.city',
  'seller.countryCode',
  'seller.vatId',
  'buyer.name',
  'buyer.street',
  'buyer.postalCode',
  'buyer.city',
  'buyer.countryCode',
  'payment.iban',
  'payment.reference',
  'payment.terms',
  'netTotalMinor',
  'taxTotalMinor',
  'grossTotalMinor',
] as const
export type SemanticFieldPath = (typeof semanticFieldPaths)[number]
export type SemanticFieldValue = {
  path: SemanticFieldPath
  value: string | number
  confidence: 'low' | 'medium' | 'high'
  sourceBlockIds: Array<string>
}
export type SemanticExtractionResult = { fields: Array<SemanticFieldValue> }
export const semanticExtractionResultSchema = {
  parse(value: unknown): SemanticExtractionResult {
    if (
      !value ||
      typeof value !== 'object' ||
      !('fields' in value) ||
      !Array.isArray(value.fields)
    )
      throw new Error('Semantic result must contain a fields array.')
    const fields = value.fields.map((entry): SemanticFieldValue => {
      if (!entry || typeof entry !== 'object')
        throw new Error('Semantic field must be an object.')
      const field = entry as Record<string, unknown>
      if (!semanticFieldPaths.includes(field['path'] as SemanticFieldPath))
        throw new Error('Semantic field path is not supported.')
      if (
        typeof field['value'] !== 'string' &&
        !(typeof field['value'] === 'number' && Number.isFinite(field['value']))
      )
        throw new Error(
          'Semantic field value must be a string or finite number.',
        )
      if (!['low', 'medium', 'high'].includes(String(field['confidence'])))
        throw new Error('Semantic confidence is invalid.')
      if (
        !Array.isArray(field['sourceBlockIds']) ||
        field['sourceBlockIds'].some((id) => typeof id !== 'string')
      )
        throw new Error('Semantic sourceBlockIds must be strings.')
      return {
        path: field['path'] as SemanticFieldPath,
        value: field['value'],
        confidence: field['confidence'] as SemanticFieldValue['confidence'],
        sourceBlockIds: field['sourceBlockIds'] as Array<string>,
      }
    })
    return { fields }
  },
}

const labels: Array<[string, RegExp]> = [
  [
    'invoice-number',
    /\b(?:invoice\s*(?:no\.?|number)|rechnungs?(?:nummer|nr\.?)?)\b/i,
  ],
  ['issue-date', /\b(?:invoice\s*date|rechnungsdatum)\b/i],
  ['due-date', /\b(?:due\s*date|zahlbar\s*(?:bis|am)|fälligkeitsdatum)\b/i],
  [
    'delivery-or-service-period',
    /\b(?:delivery\s*date|leistungsdatum|lieferdatum|leistungszeitraum)\b/i,
  ],
  [
    'seller',
    /\b(?:seller|supplier|vendor|verkäufer|lieferant|rechnungssteller)\b/i,
  ],
  ['buyer', /\b(?:buyer|bill\s*to|customer|kunde|rechnungsempfänger)\b/i],
  [
    'payment-terms',
    /\b(?:payment\s*terms?|zahlungs(?:bedingungen|ziel)|zahlbar)\b/i,
  ],
  [
    'total',
    /\b(?:netto|net\s*total|umsatzsteuer|mehrwertsteuer|gesamt(?:betrag|summe)|grand\s*total)\b/i,
  ],
  [
    'reference-number',
    /\b(?:reference|referenz|kunden(?:bestell)?nummer|order\s*(?:no|number))\b/i,
  ],
]

export function createSemanticDocument(
  document: DocumentModel,
  deterministic: ExtractionRunResult,
): SemanticDocument {
  const draft = mapExtractionResultToDraft(deterministic)
  return {
    deterministicExtraction: draft,
    pages: document.pages.map((page) => {
      const boxes = page.textItems.flatMap((item) =>
        item.boundingBox ? [item.boundingBox] : [],
      )
      const left = Math.min(0, ...boxes.map((box) => box.x))
      const bottom = Math.min(0, ...boxes.map((box) => box.y))
      const right = Math.max(1, ...boxes.map((box) => box.x + box.width))
      const top = Math.max(1, ...boxes.map((box) => box.y + box.height))
      const width = right - left || 1
      const height = top - bottom || 1
      return {
        pageNumber: page.number,
        textBlocks: page.textItems.map((item) => ({
          id: item.id,
          text: item.text,
          pageNumber: page.number,
          ...(item.boundingBox
            ? {
                boundingBox: {
                  x: (item.boundingBox.x - left) / width,
                  y: (item.boundingBox.y - bottom) / height,
                  width: item.boundingBox.width / width,
                  height: item.boundingBox.height / height,
                },
              }
            : {}),
          detectedLabels: labels.flatMap(([name, pattern]) => {
            pattern.lastIndex = 0
            return pattern.test(item.text) ? [name] : []
          }),
        })),
      }
    }),
  }
}

function readField(
  draft: InvoiceDraft,
  path: SemanticFieldPath,
): DraftField<unknown> {
  let value: unknown = draft
  for (const key of path.split('.'))
    value = (value as Record<string, unknown>)[key]
  return value as DraftField<unknown>
}

function writeField(
  draft: InvoiceDraft,
  path: SemanticFieldPath,
  field: DraftField<unknown>,
) {
  const keys = path.split('.')
  let target: Record<string, unknown> = draft
  for (const key of keys.slice(0, -1))
    target = target[key] as Record<string, unknown>
  target[keys.at(-1)!] = field
}

export function mergeSemanticResult(
  deterministicDraft: InvoiceDraft,
  result: unknown,
  document: SemanticDocument,
  sourceDocument?: DocumentModel,
): InvoiceDraft {
  const parsed = semanticExtractionResultSchema.parse(result)
  const merged = structuredClone(deterministicDraft)
  const blocks = new Map<string, SemanticTextBlock>(
    document.pages.flatMap((page) =>
      page.textBlocks.map((block): [string, SemanticTextBlock] => [
        block.id,
        block,
      ]),
    ),
  )
  const sourceItems = new Map(
    sourceDocument?.pages.flatMap((page) =>
      page.textItems.map(
        (item) => [item.id, { page: page.number, item }] as const,
      ),
    ) ?? [],
  )
  for (const item of parsed.fields) {
    if (item.sourceBlockIds.some((id) => !blocks.has(id)))
      throw new Error(
        `Semantic result references unknown source block for "${item.path}".`,
      )
    const current = readField(merged, item.path)
    if (current.status === 'user-edited' || current.status === 'user-confirmed')
      continue
    if (
      current.value !== undefined &&
      current.extractionMethod === 'deterministic' &&
      current.confidence === 'high'
    )
      continue
    const sourceBlocks = item.sourceBlockIds
      .map((id) => blocks.get(id))
      .filter((block) => block !== undefined)
    const first = sourceBlocks[0]
    const firstSource = sourceItems.get(item.sourceBlockIds[0] ?? '')
    const sourceBox = firstSource?.item.boundingBox
    writeField(merged, item.path, {
      value: item.value,
      extractedValue: item.value,
      originalExtractedValue: item.value,
      extractionMethod: 'semantic',
      confidence: item.confidence,
      status: item.confidence === 'high' ? 'extracted' : 'uncertain',
      ...(first
        ? {
            source: {
              page: firstSource?.page ?? first.pageNumber,
              sourceText: sourceBlocks.map((block) => block.text).join(' '),
              sourceItemIds: item.sourceBlockIds,
              ...(sourceBox ? { boundingBox: sourceBox } : {}),
            },
          }
        : {}),
    })
  }
  return merged
}

/** Local deterministic semantic plug-in. No network/provider dependency. */
export function createMockSemanticPlugin(): ExtractionPlugin {
  return {
    id: 'mock-semantic',
    phase: 'semantic',
    fieldGroups: [],
    priority: 10,
    run(context) {
      const input = context.semantic
      if (!input)
        throw new Error('Semantic plug-in was run without semantic input.')
      const fields: Array<SemanticFieldValue> = []
      for (const page of input.document.pages)
        for (const block of page.textBlocks) {
          const number = block.text.match(
            /(?:invoice\s*(?:no\.?|number)|rechnungs?(?:nummer|nr\.?)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,})/i,
          )
          if (number?.[1])
            fields.push({
              path: 'number',
              value: number[1],
              confidence: 'medium',
              sourceBlockIds: [block.id],
            })
          const reference = block.text.match(
            /(?:reference|referenz|kunden(?:bestell)?nummer|order\s*(?:no|number))\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{1,})/i,
          )
          if (reference?.[1])
            fields.push({
              path: 'payment.reference',
              value: reference[1],
              confidence: 'medium',
              sourceBlockIds: [block.id],
            })
          const terms = block.text.match(
            /(?:zahlbar\s+)?innerhalb\s+von\s+(\d{1,3})\s+(?:kalender)?tagen/i,
          )
          if (terms?.[0])
            fields.push({
              path: 'payment.terms',
              value: terms[0],
              confidence: 'medium',
              sourceBlockIds: [block.id],
            })
        }
      return Promise.resolve({
        semanticResult: semanticExtractionResultSchema.parse({ fields }),
      })
    },
  }
}

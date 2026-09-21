import { z } from 'zod'

export type Money = number

const money = z.number().int().safe().nonnegative()
const vatCategory = z.enum(['S', 'Z'])
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const constructed = new Date(`${value}T00:00:00Z`)
      return (
        Number.isFinite(constructed.getTime()) &&
        constructed.toISOString().startsWith(value)
      )
    },
    {
      message: 'muss ein gültiges Kalenderdatum sein',
    },
  )
const country = z.string().regex(/^[A-Z]{2}$/)
const currency = z.string().regex(/^[A-Z]{3}$/)

export const invoiceSchema = z
  .object({
    number: z.string().trim().min(1),
    issueDate: date,
    deliveryDate: date,
    currency,
    seller: z.object({
      name: z.string().trim().min(1),
      street: z.string().trim().min(1),
      postalCode: z.string().trim().min(1),
      city: z.string().trim().min(1),
      countryCode: country,
      vatId: z.string().trim().min(1),
    }),
    buyer: z.object({
      name: z.string().trim().min(1),
      street: z.string().trim().min(1),
      postalCode: z.string().trim().min(1),
      city: z.string().trim().min(1),
      countryCode: country,
    }),
    lines: z
      .array(
        z.object({
          description: z.string().trim().min(1),
          quantity: z.number().positive(),
          unitCode: z
            .string()
            .regex(/^[A-Z0-9]{1,3}$/)
            .default('C62'),
          unitPriceMinor: money,
          netAmountMinor: money,
          vatCategory: vatCategory.default('S'),
          vatRateBasisPoints: z.number().int().min(0).max(10000),
        }),
      )
      .min(1),
    vatBreakdown: z
      .array(
        z.object({
          vatCategory: vatCategory.default('S'),
          rateBasisPoints: z.number().int().min(0).max(10000),
          taxableAmountMinor: money,
          taxAmountMinor: money,
        }),
      )
      .min(1),
    netTotalMinor: money,
    taxTotalMinor: money,
    grossTotalMinor: money,
    payment: z.object({
      iban: z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/),
      bic: z
        .string()
        .regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/)
        .optional(),
      dueDate: date.optional(),
      reference: z.string().trim().min(1).optional(),
    }),
  })
  .superRefine((invoice, context) => {
    const add = (path: Array<string | number>, message: string) =>
      context.addIssue({ code: 'custom', path, message })
    const sum = (values: Array<number>) =>
      values.reduce((total, value) => total + value, 0)
    const vatKey = (category: 'S' | 'Z', rateBasisPoints: number) =>
      `${category}:${rateBasisPoints}`
    const validateVat = (
      category: 'S' | 'Z',
      rateBasisPoints: number,
      path: Array<string | number>,
    ) => {
      if (category === 'S' && rateBasisPoints < 2) {
        add(path, 'Der Regelsteuersatz muss über einem Basispunkt liegen')
      }
      if (category === 'Z' && rateBasisPoints !== 0) {
        add(path, 'Der Steuersatz muss null Basispunkte betragen')
      }
    }

    invoice.lines.forEach((line, index) => {
      validateVat(line.vatCategory, line.vatRateBasisPoints, [
        'lines',
        index,
        'vatRateBasisPoints',
      ])
      if (
        Math.round(line.unitPriceMinor * line.quantity) !== line.netAmountMinor
      ) {
        add(
          ['lines', index, 'netAmountMinor'],
          'muss Menge × Einzelpreis entsprechen',
        )
      }
    })

    const netTotal = sum(invoice.lines.map((line) => line.netAmountMinor))
    if (netTotal !== invoice.netTotalMinor)
      add(['netTotalMinor'], 'muss der Summe der Nettopositionen entsprechen')

    const taxTotal = sum(invoice.vatBreakdown.map((vat) => vat.taxAmountMinor))
    if (taxTotal !== invoice.taxTotalMinor)
      add(['taxTotalMinor'], 'muss der Summe der Umsatzsteuer entsprechen')

    if (
      invoice.netTotalMinor + invoice.taxTotalMinor !==
      invoice.grossTotalMinor
    ) {
      add(['grossTotalMinor'], 'muss Nettosumme + Umsatzsteuer entsprechen')
    }

    const lineVatKeys = new Set(
      invoice.lines.map((line) =>
        vatKey(line.vatCategory, line.vatRateBasisPoints),
      ),
    )
    const breakdownVatKeys = new Set<string>()
    invoice.vatBreakdown.forEach((vat, index) => {
      validateVat(vat.vatCategory, vat.rateBasisPoints, [
        'vatBreakdown',
        index,
        'rateBasisPoints',
      ])
      const key = vatKey(vat.vatCategory, vat.rateBasisPoints)
      if (breakdownVatKeys.has(key))
        add(['vatBreakdown', index], 'Umsatzsteuergruppe ist doppelt vorhanden')
      breakdownVatKeys.add(key)
      const lineNet = sum(
        invoice.lines
          .filter(
            (line) =>
              line.vatCategory === vat.vatCategory &&
              line.vatRateBasisPoints === vat.rateBasisPoints,
          )
          .map((line) => line.netAmountMinor),
      )
      if (vat.taxableAmountMinor !== lineNet) {
        add(
          ['vatBreakdown', index],
          'Nettobetrag muss den Positionen entsprechen',
        )
      }
      if (
        vat.taxAmountMinor !==
        Math.round((vat.taxableAmountMinor * vat.rateBasisPoints) / 10000)
      ) {
        add(['vatBreakdown', index], 'Umsatzsteuerbetrag ist nicht stimmig')
      }
    })
    for (const key of lineVatKeys) {
      if (!breakdownVatKeys.has(key))
        add(['vatBreakdown'], `Umsatzsteuergruppe ${key} fehlt`)
    }
  })

export type Invoice = z.infer<typeof invoiceSchema>

declare const verifiedInvoiceBrand: unique symbol
export type VerifiedInvoice = Invoice & {
  readonly [verifiedInvoiceBrand]: true
}

const resolvedField = <T>(field: DraftField<T>): T | undefined => {
  if (
    field.status === 'missing' ||
    field.status === 'uncertain' ||
    field.status === 'extracted'
  ) {
    return undefined
  }
  return field.value
}

/** Builds a domain invoice only after every exported field is reviewer-resolved. */
export function verifyInvoiceDraft(draft: InvoiceDraft): VerifiedInvoice {
  const value = {
    number: resolvedField(draft.number),
    issueDate: resolvedField(draft.issueDate),
    deliveryDate: resolvedField(draft.deliveryDate),
    currency: resolvedField(draft.currency),
    seller: {
      name: resolvedField(draft.seller.name),
      street: resolvedField(draft.seller.street),
      postalCode: resolvedField(draft.seller.postalCode),
      city: resolvedField(draft.seller.city),
      countryCode: resolvedField(draft.seller.countryCode),
      vatId: resolvedField(draft.seller.vatId ?? { status: 'missing' }),
    },
    buyer: {
      name: resolvedField(draft.buyer.name),
      street: resolvedField(draft.buyer.street),
      postalCode: resolvedField(draft.buyer.postalCode),
      city: resolvedField(draft.buyer.city),
      countryCode: resolvedField(draft.buyer.countryCode),
    },
    lines: draft.lines.map((line) => ({
      description: resolvedField(line.description),
      quantity: resolvedField(line.quantity),
      unitCode: resolvedField(line.unitCode),
      unitPriceMinor: resolvedField(line.unitPriceMinor),
      netAmountMinor: resolvedField(line.netAmountMinor),
      vatCategory:
        resolvedField(line.vatRateBasisPoints) === 0
          ? ('Z' as const)
          : ('S' as const),
      vatRateBasisPoints: resolvedField(line.vatRateBasisPoints),
    })),
    vatBreakdown: draft.vatBreakdown.map((vat) => ({
      vatCategory:
        resolvedField(vat.rateBasisPoints) === 0
          ? ('Z' as const)
          : ('S' as const),
      rateBasisPoints: resolvedField(vat.rateBasisPoints),
      taxableAmountMinor: resolvedField(vat.taxableAmountMinor),
      taxAmountMinor: resolvedField(vat.taxAmountMinor),
    })),
    netTotalMinor: resolvedField(draft.netTotalMinor),
    taxTotalMinor: resolvedField(draft.taxTotalMinor),
    grossTotalMinor: resolvedField(draft.grossTotalMinor),
    payment: {
      iban: resolvedField(draft.payment.iban),
      ...(draft.payment.bic && resolvedField(draft.payment.bic)
        ? { bic: resolvedField(draft.payment.bic) }
        : {}),
      ...(resolvedField(draft.payment.reference)
        ? { reference: resolvedField(draft.payment.reference) }
        : {}),
      ...(resolvedField(draft.dueDate)
        ? { dueDate: resolvedField(draft.dueDate) }
        : {}),
    },
  }
  return invoiceSchema.parse(value) as VerifiedInvoice
}

export function parseVerifiedInvoice(value: unknown): VerifiedInvoice {
  return invoiceSchema.parse(value) as VerifiedInvoice
}

export type ExtractionStatus =
  'extracted' | 'uncertain' | 'user-confirmed' | 'user-edited' | 'missing'

export type FieldSource = {
  page: number
  sourceText: string
  sourceItemIds: Array<string>
  boundingBox?: { x: number; y: number; width: number; height: number }
  label?: string
}

export type DraftField<T> = {
  value?: T
  extractedValue?: T
  originalExtractedValue?: T
  extractionMethod?: 'deterministic' | 'semantic' | 'user'
  originalExtractionMethod?: 'deterministic' | 'semantic'
  confidence?: 'low' | 'medium' | 'high'
  status: ExtractionStatus
  source?: FieldSource
  alternatives?: Array<{
    value: T
    source?: FieldSource
    label?: string
  }>
}

export type DraftParty = {
  name: DraftField<string>
  street: DraftField<string>
  postalCode: DraftField<string>
  city: DraftField<string>
  countryCode: DraftField<string>
  vatId?: DraftField<string>
}

export type InvoiceDraft = {
  number: DraftField<string>
  issueDate: DraftField<string>
  deliveryDate: DraftField<string>
  dueDate: DraftField<string>
  currency: DraftField<string>
  seller: DraftParty
  buyer: DraftParty
  lines: Array<{
    description: DraftField<string>
    quantity: DraftField<number>
    unitCode: DraftField<string>
    unitPriceMinor: DraftField<number>
    netAmountMinor: DraftField<number>
    vatRateBasisPoints: DraftField<number>
  }>
  vatBreakdown: Array<{
    rateBasisPoints: DraftField<number>
    taxableAmountMinor: DraftField<number>
    taxAmountMinor: DraftField<number>
  }>
  netTotalMinor: DraftField<number>
  taxTotalMinor: DraftField<number>
  grossTotalMinor: DraftField<number>
  payment: {
    iban: DraftField<string>
    bic?: DraftField<string>
    reference: DraftField<string>
    terms: DraftField<string>
  }
}

const missing = <T>(): DraftField<T> => ({ status: 'missing' })
const party = (seller = false): DraftParty => ({
  name: missing(),
  street: missing(),
  postalCode: missing(),
  city: missing(),
  countryCode: missing(),
  ...(seller ? { vatId: missing() } : {}),
})

export function createInvoiceDraft(): InvoiceDraft {
  return {
    number: missing(),
    issueDate: missing(),
    deliveryDate: missing(),
    dueDate: missing(),
    currency: { value: 'EUR', status: 'missing' },
    seller: party(true),
    buyer: party(),
    lines: [],
    vatBreakdown: [],
    netTotalMinor: missing(),
    taxTotalMinor: missing(),
    grossTotalMinor: missing(),
    payment: {
      iban: missing(),
      bic: missing(),
      reference: missing(),
      terms: missing(),
    },
  }
}

/** Keeps extracted evidence while making the edited value authoritative. */
export function editDraftField<T>(
  field: DraftField<T>,
  value: T,
): DraftField<T> {
  return {
    ...field,
    value,
    ...(field.extractedValue === undefined && field.source
      ? { extractedValue: field.value }
      : {}),
    ...(field.extractedValue !== undefined
      ? {
          originalExtractedValue:
            field.originalExtractedValue ?? field.extractedValue,
        }
      : {}),
    ...(field.extractionMethod && field.extractionMethod !== 'user'
      ? { originalExtractionMethod: field.extractionMethod }
      : {}),
    extractionMethod: 'user',
    status: 'user-edited',
  }
}

/** Records an explicit reviewer acceptance without discarding extraction evidence. */
export function confirmDraftField<T>(field: DraftField<T>): DraftField<T> {
  return {
    ...field,
    ...(field.extractedValue === undefined && field.source
      ? { extractedValue: field.value }
      : {}),
    status: 'user-confirmed',
  }
}

export type DraftValidationIssue = {
  path: string
  message: string
  severity: 'error' | 'warning'
}

export function validateInvoiceDraft(
  draft: InvoiceDraft,
): Array<DraftValidationIssue> {
  const issues: Array<DraftValidationIssue> = []
  const required: Array<[string, DraftField<unknown>]> = [
    ['number', draft.number],
    ['issueDate', draft.issueDate],
    ['seller.name', draft.seller.name],
    ['buyer.name', draft.buyer.name],
    ['netTotalMinor', draft.netTotalMinor],
    ['taxTotalMinor', draft.taxTotalMinor],
    ['grossTotalMinor', draft.grossTotalMinor],
  ]
  for (const [path, field] of required) {
    if (field.value === undefined || field.value === '')
      issues.push({
        path,
        message: 'Pflichtangabe fehlt',
        severity: 'error',
      })
  }
  const uncertain = (path: string, field: DraftField<unknown>) => {
    if (field.status === 'uncertain' || field.status === 'extracted')
      issues.push({
        path,
        message:
          field.status === 'extracted'
            ? 'Erkannter Wert muss bestätigt oder bearbeitet werden'
            : 'Erkannter Wert muss geprüft werden',
        severity: 'warning',
      })
  }
  required.forEach(([path, field]) => uncertain(path, field))
  draft.lines.forEach((line, index) => {
    const quantity = line.quantity.value
    const price = line.unitPriceMinor.value
    const total = line.netAmountMinor.value
    if (
      quantity !== undefined &&
      price !== undefined &&
      total !== undefined &&
      Math.round(quantity * price) !== total
    )
      issues.push({
        path: `lines.${index}.netAmountMinor`,
        message: 'Positionssumme entspricht nicht Menge × Einzelpreis',
        severity: 'error',
      })
  })
  const lineTotal = draft.lines.reduce(
    (sum, line) => sum + (line.netAmountMinor.value ?? 0),
    0,
  )
  if (
    draft.lines.length &&
    draft.netTotalMinor.value !== undefined &&
    lineTotal !== draft.netTotalMinor.value
  )
    issues.push({
      path: 'netTotalMinor',
      message: 'Nettosumme entspricht nicht der Summe der Positionen',
      severity: 'error',
    })
  const vatTotal = draft.vatBreakdown.reduce(
    (sum, vat) => sum + (vat.taxAmountMinor.value ?? 0),
    0,
  )
  if (
    draft.vatBreakdown.length &&
    draft.taxTotalMinor.value !== undefined &&
    vatTotal !== draft.taxTotalMinor.value
  )
    issues.push({
      path: 'taxTotalMinor',
      message: 'Umsatzsteuer gesamt entspricht nicht der Aufschlüsselung',
      severity: 'error',
    })
  if (
    draft.netTotalMinor.value !== undefined &&
    draft.taxTotalMinor.value !== undefined &&
    draft.grossTotalMinor.value !== undefined &&
    draft.netTotalMinor.value + draft.taxTotalMinor.value !==
      draft.grossTotalMinor.value
  )
    issues.push({
      path: 'grossTotalMinor',
      message: 'Bruttosumme entspricht nicht Nettosumme + Umsatzsteuer',
      severity: 'error',
    })
  return issues
}

export function parseInvoice(value: unknown): Invoice {
  return invoiceSchema.parse(value)
}

export function formatMoney(minor: Money, currencyCode = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currencyCode,
  }).format(minor / 100)
}

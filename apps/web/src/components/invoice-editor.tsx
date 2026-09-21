import { useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Info,
  Plus,
  Square,
  Trash2,
} from 'lucide-react'
import {
  confirmDraftField,
  editDraftField,
  formatMoney,
  validateInvoiceDraft,
} from '@app/invoice-core'
import type { DraftField, InvoiceDraft } from '@app/invoice-core'
import type { PdfViewerController } from '@/lib/pdf-source'
import type { ReviewIssue } from '@/lib/review'
import { buildReviewQueue } from '@/lib/review'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Props = {
  draft: InvoiceDraft
  onChange: (draft: InvoiceDraft) => void
  viewerController?: PdfViewerController | null
  canGenerate?: boolean
  generating?: boolean
  onGenerate?: () => void
}
type FieldProps = {
  path: string
  label: string
  field: DraftField<string | number>
  onChange: (value: string) => void
  onConfirm?: () => void
  onChooseAlternative?: (index: number) => void
  onSelect: (path: string, field: DraftField<string | number>) => void
  selected: boolean
  invalid: boolean
  numeric?: boolean
  decimal?: boolean
  multiline?: boolean
  inline?: boolean
  percentage?: boolean
  compact?: boolean
  issue?: string | undefined
}

const fieldId = (path: string) => `invoice-${path.replaceAll('.', '-')}`

function Field({
  path,
  label,
  field,
  onChange,
  onConfirm,
  onChooseAlternative,
  onSelect,
  selected,
  invalid,
  numeric,
  decimal,
  multiline,
  inline,
  percentage,
  compact,
  issue,
}: FieldProps) {
  const id = fieldId(path)
  const value =
    field.value === undefined
      ? ''
      : numeric
        ? (Number(field.value) / 100).toFixed(2)
        : percentage
          ? trimDecimal(Number(field.value) / 100)
          : String(field.value)
  const common = {
    id,
    name: id,
    value,
    onFocus: () => onSelect(path, field),
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    'aria-label': label,
    'aria-invalid': invalid || undefined,
    'aria-describedby': issue ? `${id}-issue` : undefined,
  }
  const needsReview =
    field.status === 'uncertain' || field.status === 'extracted'
  const className = `${multiline ? 'min-h-16 ' : ''}${compact ? 'max-w-72 ' : ''}bg-white ${
    selected ? 'ring-2 ring-stone-600' : ''
  } ${needsReview ? 'border-amber-600' : ''}`
  const confidence = field.confidence
    ? ({ high: 'hoch', medium: 'mittel', low: 'niedrig' } as const)[
        field.confidence
      ]
    : undefined
  const method =
    field.extractionMethod === 'user'
      ? 'Manuell korrigiert'
      : field.extractionMethod === 'semantic'
        ? 'Semantisch erkannt'
        : field.extractionMethod === 'deterministic'
          ? 'Deterministisch erkannt'
          : undefined
  const sourcePage =
    field.source &&
    `Seite ${field.source.page}${field.source.sourceText ? ` · ${field.source.sourceText}` : ''}`
  const details = [
    method,
    confidence && `Sicherheit: ${confidence}`,
    sourcePage,
  ]
    .filter(Boolean)
    .join(' · ')
  const shortDetails = [
    method === 'Manuell korrigiert'
      ? 'Korrigiert'
      : method === 'Semantisch erkannt'
        ? 'Semantisch'
        : method
          ? 'Erkannt'
          : undefined,
    confidence === 'hoch'
      ? 'Sicher'
      : confidence === 'niedrig'
        ? 'Unsicher'
        : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const statusIcon = needsReview ? (
    <AlertCircle className="size-3.5 text-amber-700" aria-hidden="true" />
  ) : field.status === 'missing' ? (
    <Circle className="size-3.5 text-stone-400" aria-hidden="true" />
  ) : (
    <CheckCircle2 className="size-3.5 text-green-700" aria-hidden="true" />
  )
  return (
    <div
      className={`grid gap-1 text-xs font-medium text-stone-700 ${inline ? 'grid-cols-[minmax(8rem,0.9fr)_minmax(0,1.5fr)] items-center gap-x-3' : ''}`}
    >
      <label htmlFor={id}>{label}</label>
      <span className="grid min-w-0 gap-1">
        {multiline ? (
          <Textarea {...common} className={className} />
        ) : (
          <Input
            {...common}
            type={
              percentage
                ? 'text'
                : numeric || decimal
                  ? 'number'
                  : /(?:Date|dueDate)$/.test(path)
                    ? 'date'
                    : 'text'
            }
            inputMode={percentage ? 'decimal' : undefined}
            step={numeric ? '0.01' : decimal ? 'any' : undefined}
            className={className}
          />
        )}
        {field.alternatives && field.alternatives.length > 0 && (
          <select
            id={`${id}-alternatives`}
            name={`${id}-alternatives`}
            aria-label={`${label} – weitere erkannte Beträge`}
            className="h-8 w-full max-w-72 min-w-0 rounded-md border border-stone-300 bg-white px-2 text-xs font-normal text-stone-700"
            value=""
            onChange={(event) =>
              onChooseAlternative?.(Number(event.currentTarget.value))
            }
          >
            <option value="">Anderen erkannten Betrag übernehmen …</option>
            {field.alternatives.map((alternative, index) => (
              <option key={`${alternative.value}-${index}`} value={index}>
                {formatMoney(Number(alternative.value))}
                {alternative.label ? ` · ${alternative.label}` : ''}
              </option>
            ))}
          </select>
        )}
        <span className="flex min-h-7 items-center justify-between gap-2 font-normal text-stone-500">
          <span className="flex min-w-0 items-center gap-1">
            {statusIcon}
            {field.status === 'missing' && <span>Nicht erkannt</span>}
            {details && (
              <span className="inline-flex items-center gap-1">
                {shortDetails && <span>{shortDetails}</span>}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        id={`${id}-details`}
                        name={`${id}-details`}
                        type="button"
                        className="text-stone-500 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-stone-600"
                        aria-label={`Details zu ${label}: ${details}`}
                        onClick={(event) => event.preventDefault()}
                      >
                        <Info className="size-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{details}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            )}
          </span>
          {needsReview && (
            <Button
              id={`${id}-confirm`}
              name={`${id}-confirm`}
              type="button"
              size="xs"
              variant="outline"
              className="shrink-0"
              onClick={(event) => {
                event.preventDefault()
                onConfirm?.()
              }}
            >
              Bestätigen
            </Button>
          )}
        </span>
        {issue && (
          <span className="font-normal text-red-700" id={`${id}-issue`}>
            {issue}
          </span>
        )}
      </span>
    </div>
  )
}

function trimDecimal(value: number) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(
    value,
  )
}

function shiftCompletedLineReviews(
  completedReviews: Map<string, ReviewIssue>,
  removedIndex: number,
) {
  const shifted = new Map<string, ReviewIssue>()
  for (const issue of completedReviews.values()) {
    const match = /^lines\.(\d+)\.(.+)$/.exec(issue.path)
    if (!match) {
      shifted.set(issue.path, issue)
      continue
    }
    const lineIndex = Number(match[1])
    if (lineIndex === removedIndex) continue
    const nextIndex = lineIndex > removedIndex ? lineIndex - 1 : lineIndex
    const path = `lines.${nextIndex}.${match[2]}`
    shifted.set(path, { ...issue, path })
  }
  return shifted
}

function Section({
  title,
  children,
  columns = 2,
}: {
  title: string
  children: React.ReactNode
  columns?: 1 | 2
}) {
  return (
    <section className="border-b border-stone-200 px-4 py-4">
      <h2 className="mb-3 text-sm font-semibold text-stone-900">{title}</h2>
      <div
        className={`grid gap-3 ${columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}
      >
        {children}
      </div>
    </section>
  )
}
const text = (value: string) => value
const money = (value: string) => {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

export function InvoiceEditor({
  draft,
  onChange,
  viewerController,
  canGenerate = false,
  generating = false,
  onGenerate,
}: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [completedReviews, setCompletedReviews] = useState<
    Map<string, ReviewIssue>
  >(() => new Map())
  const update = (
    path: string,
    value: string,
    numeric = false,
    percentage = false,
  ) => {
    const next = structuredClone(draft)
    const keys = path.split('.')
    let target: Record<string, unknown> = next
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>
    const key = keys.at(-1)!
    const parsed = numeric
      ? money(value)
      : percentage
        ? Math.round(Number(value.replace(',', '.')) * 100)
        : /(?:quantity|vatRateBasisPoints)$/.test(path)
          ? Number(value)
          : text(value)
    target[key] = editDraftField(
      target[key] as DraftField<string | number>,
      parsed,
    )
    onChange(next)
  }
  const confirm = (path: string) => {
    const next = structuredClone(draft)
    const keys = path.split('.')
    let target: Record<string, unknown> = next
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>
    const key = keys.at(-1)!
    target[key] = confirmDraftField(target[key] as DraftField<unknown>)
    onChange(next)
  }
  const completeReview = (path: string) => {
    const issue = reviewQueue.find((item) => item.path === path)
    if (issue) {
      setCompletedReviews((current) => new Map(current).set(path, issue))
    }
    confirm(path)
  }
  const chooseAlternative = (path: string, index: number) => {
    const next = structuredClone(draft)
    const keys = path.split('.')
    let target: Record<string, unknown> = next
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>
    const key = keys.at(-1)!
    const field = target[key] as DraftField<string | number>
    const alternative = field.alternatives?.[index]
    if (!alternative) return
    target[key] = editDraftField(
      {
        ...field,
        ...(alternative.source ? { source: alternative.source } : {}),
        extractedValue: alternative.value,
      },
      alternative.value,
    )
    if (alternative.source) {
      viewerController?.highlightSources([alternative.source])
      viewerController?.scrollToSource(alternative.source)
    }
    onChange(next)
  }
  const issues = validateInvoiceDraft(draft)
  const reviewQueue = buildReviewQueue(draft)
  const reviewItems = [
    ...reviewQueue,
    ...[...completedReviews.values()].filter(
      (item) => !reviewQueue.some((current) => current.path === item.path),
    ),
  ]
  const invalidPaths = new Set(
    issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.path),
  )
  const issueMessages = new Map(
    issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => [issue.path, issue.message]),
  )
  const selectField = (path: string, field: DraftField<string | number>) => {
    setSelectedPath(path)
    if (!field.source) {
      viewerController?.clearHighlights()
      return
    }
    viewerController?.highlightSources([field.source])
    viewerController?.scrollToSource(field.source)
  }
  const bind = (path: string, field: DraftField<string | number>) => ({
    path,
    field,
    onSelect: selectField,
    selected: selectedPath === path,
    invalid: invalidPaths.has(path),
    issue: issueMessages.get(path),
    onConfirm: () => completeReview(path),
  })
  const reviewTarget = (path: string) => {
    const parts = path.split('.')
    const lineIndex = parts[0] === 'lines' ? Number(parts[1]) + 1 : undefined
    const segment = parts.at(-1) ?? path
    const labels: Record<string, string> = {
      number: 'Rechnungsnummer',
      issueDate: 'Rechnungsdatum',
      deliveryDate: 'Leistungsdatum',
      dueDate: 'Fälligkeit',
      name: 'Name',
      street: 'Straße',
      postalCode: 'PLZ',
      city: 'Ort',
      countryCode: 'Land',
      vatId: 'USt-IdNr.',
      quantity: 'Menge',
      description: 'Bezeichnung',
      unitPriceMinor: 'Einzelpreis',
      netAmountMinor: 'Positionssumme',
      vatRateBasisPoints: 'Umsatzsteuersatz',
      rateBasisPoints: 'Umsatzsteuersatz',
      taxableAmountMinor: 'Nettobetrag',
      taxAmountMinor: 'Steuerbetrag',
      netTotalMinor: 'Nettosumme',
      taxTotalMinor: 'Umsatzsteuer gesamt',
      grossTotalMinor: 'Bruttosumme',
      iban: 'IBAN',
      reference: 'Verwendungszweck',
      terms: 'Zahlungsbedingungen',
      currency: 'Währung',
    }
    const fieldLabel = labels[segment] ?? segment
    if (lineIndex !== undefined) return `Position ${lineIndex} · ${fieldLabel}`
    if (parts[0] === 'seller') return `Rechnungssteller · ${fieldLabel}`
    if (parts[0] === 'buyer') return `Rechnungsempfänger · ${fieldLabel}`
    if (parts[0] === 'payment') return `Zahlung · ${fieldLabel}`
    if (parts[0] === 'vatBreakdown')
      return `Steueraufschlüsselung · ${fieldLabel}`
    return fieldLabel
  }
  const moveReview = (offset: number) => {
    if (!reviewQueue.length) return
    const current = reviewQueue.findIndex(
      (issue) => issue.path === selectedPath,
    )
    const index =
      current < 0
        ? offset > 0
          ? 0
          : reviewQueue.length - 1
        : (current + offset + reviewQueue.length) % reviewQueue.length
    document.getElementById(fieldId(reviewQueue[index]!.path))?.focus()
  }
  const addLine = () =>
    onChange({
      ...draft,
      lines: [
        ...draft.lines,
        {
          description: { status: 'missing' },
          quantity: { value: 1, status: 'missing' },
          unitCode: { value: 'C62', status: 'missing' },
          unitPriceMinor: { value: 0, status: 'missing' },
          netAmountMinor: { value: 0, status: 'missing' },
          vatRateBasisPoints: { value: 1900, status: 'missing' },
        },
      ],
    })
  const removeLine = (index: number) => {
    setCompletedReviews((current) => shiftCompletedLineReviews(current, index))
    onChange({
      ...draft,
      lines: draft.lines.filter((_, lineIndex) => lineIndex !== index),
    })
  }
  const addVat = () =>
    onChange({
      ...draft,
      vatBreakdown: [
        ...draft.vatBreakdown,
        {
          rateBasisPoints: { value: 1900, status: 'missing' },
          taxableAmountMinor: { value: 0, status: 'missing' },
          taxAmountMinor: { value: 0, status: 'missing' },
        },
      ],
    })

  return (
    <aside
      aria-label="Rechnungsdaten"
      className="h-full min-w-0 overflow-y-auto bg-stone-50"
    >
      <div className="sticky top-0 z-20 border-b border-stone-300 bg-stone-50">
        <div className="px-4 py-3">
          <p className="text-sm font-semibold">Rechnungsdaten</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              id="invoice-review-previous"
              name="invoice-review-previous"
              type="button"
              size="sm"
              variant="outline"
              disabled={!reviewQueue.length}
              onClick={() => moveReview(-1)}
            >
              <ChevronLeft /> Vorheriger Prüfpunkt
            </Button>
            <Button
              id="invoice-review-next"
              name="invoice-review-next"
              type="button"
              size="sm"
              variant="outline"
              disabled={!reviewQueue.length}
              onClick={() => moveReview(1)}
            >
              Nächster Prüfpunkt <ChevronRight />
            </Button>
            <span className="ml-auto text-xs text-stone-600">
              {reviewQueue.length} noch zu prüfen
            </span>
          </div>
          <div className="mt-2 flex justify-end border-t border-stone-200 pt-2">
            <Button
              id="invoice-generate-zugferd"
              name="invoice-generate-zugferd"
              type="button"
              size="sm"
              disabled={!canGenerate || generating}
              onClick={onGenerate}
            >
              <Download />
              {generating
                ? 'Rechnung wird erstellt …'
                : 'ZUGFeRD herunterladen'}
            </Button>
          </div>
        </div>
        {reviewItems.length > 0 && (
          <section
            aria-label="Prüfcheckliste"
            className="border-t border-stone-300 bg-white px-4 py-2"
          >
            <h2 className="text-sm font-semibold">Prüfpunkte</h2>
            <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto pr-1">
              {reviewItems.map((issue) => {
                const completed = completedReviews.has(issue.path)
                return (
                  <li key={issue.path}>
                    <button
                      id={`review-${fieldId(issue.path)}`}
                      name={`review-${fieldId(issue.path)}`}
                      type="button"
                      className="flex w-full items-start gap-2 py-1 text-left text-xs text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-stone-600"
                      aria-label={`${reviewTarget(issue.path)}: ${issue.message}${completed ? ', erledigt' : ''}`}
                      onClick={() => {
                        if (completed) {
                          document.getElementById(fieldId(issue.path))?.focus()
                        } else if (issue.message.includes('bestätigt'))
                          completeReview(issue.path)
                        else
                          document.getElementById(fieldId(issue.path))?.focus()
                      }}
                    >
                      {completed ? (
                        <Check
                          className="mt-0.5 size-3.5 shrink-0 text-green-700"
                          aria-hidden="true"
                        />
                      ) : (
                        <Square
                          className="mt-0.5 size-3.5 shrink-0 text-amber-700"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={`min-w-0 ${completed ? 'text-stone-500 line-through' : ''}`}
                      >
                        <span className="font-medium">
                          {reviewTarget(issue.path)}
                        </span>
                        <span
                          className={`ml-2 ${completed ? '' : issue.severity === 'error' ? 'text-red-700' : 'text-stone-500'}`}
                        >
                          {issue.severity === 'error'
                            ? issue.message
                            : issue.message.includes('bestätigt')
                              ? 'Bestätigen'
                              : 'Prüfen'}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
      <Section title="Allgemein">
        <Field
          label="Rechnungsnummer"
          {...bind('number', draft.number)}
          onChange={(v) => update('number', v)}
        />
        <Field
          label="Rechnungsdatum"
          {...bind('issueDate', draft.issueDate)}
          onChange={(v) => update('issueDate', v)}
        />
        <Field
          label="Liefer-/Leistungsdatum"
          {...bind('deliveryDate', draft.deliveryDate)}
          onChange={(v) => update('deliveryDate', v)}
        />
        <Field
          label="Fällig am"
          {...bind('dueDate', draft.dueDate)}
          onChange={(v) => update('dueDate', v)}
        />
        <Field
          label="Währung"
          {...bind('currency', draft.currency)}
          onChange={(v) => update('currency', v)}
        />
      </Section>
      <Section title="Rechnungssteller" columns={1}>
        <Field
          label="Name"
          {...bind('seller.name', draft.seller.name)}
          onChange={(v) => update('seller.name', v)}
          inline
        />
        <Field
          label="Straße"
          {...bind('seller.street', draft.seller.street)}
          onChange={(v) => update('seller.street', v)}
          inline
        />
        <Field
          label="PLZ"
          {...bind('seller.postalCode', draft.seller.postalCode)}
          onChange={(v) => update('seller.postalCode', v)}
          inline
        />
        <Field
          label="Ort"
          {...bind('seller.city', draft.seller.city)}
          onChange={(v) => update('seller.city', v)}
          inline
        />
        <Field
          label="Land"
          {...bind('seller.countryCode', draft.seller.countryCode)}
          onChange={(v) => update('seller.countryCode', v)}
          inline
        />
        <Field
          label="USt-IdNr."
          {...bind('seller.vatId', draft.seller.vatId!)}
          onChange={(v) => update('seller.vatId', v)}
          inline
        />
      </Section>
      <Section title="Rechnungsempfänger" columns={1}>
        <Field
          label="Name"
          {...bind('buyer.name', draft.buyer.name)}
          onChange={(v) => update('buyer.name', v)}
          inline
        />
        <Field
          label="Straße"
          {...bind('buyer.street', draft.buyer.street)}
          onChange={(v) => update('buyer.street', v)}
          inline
        />
        <Field
          label="PLZ"
          {...bind('buyer.postalCode', draft.buyer.postalCode)}
          onChange={(v) => update('buyer.postalCode', v)}
          inline
        />
        <Field
          label="Ort"
          {...bind('buyer.city', draft.buyer.city)}
          onChange={(v) => update('buyer.city', v)}
          inline
        />
        <Field
          label="Land"
          {...bind('buyer.countryCode', draft.buyer.countryCode)}
          onChange={(v) => update('buyer.countryCode', v)}
          inline
        />
      </Section>
      <section className="border-b border-stone-200 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Rechnungspositionen</h2>
          <Button
            id="invoice-line-add"
            name="invoice-line-add"
            type="button"
            size="sm"
            variant="outline"
            onClick={addLine}
          >
            <Plus /> Position hinzufügen
          </Button>
        </div>
        <div className="space-y-3">
          {draft.lines.length === 0 ? (
            <p className="text-xs text-stone-600">
              Keine verlässlichen Rechnungspositionen erkannt.
            </p>
          ) : (
            draft.lines.map((line, index) => (
              <div
                className="grid grid-cols-2 gap-2 border-b border-stone-200 py-3"
                key={index}
              >
                <Field
                  label={`Bezeichnung ${index + 1}`}
                  {...bind(`lines.${index}.description`, line.description)}
                  onChange={(v) => update(`lines.${index}.description`, v)}
                />
                <Field
                  label={`Menge ${index + 1}`}
                  {...bind(`lines.${index}.quantity`, line.quantity)}
                  onChange={(v) => update(`lines.${index}.quantity`, v)}
                  decimal
                />
                <Field
                  label={`Einheit ${index + 1}`}
                  {...bind(`lines.${index}.unitCode`, line.unitCode)}
                  onChange={(v) => update(`lines.${index}.unitCode`, v)}
                />
                <Field
                  label={`Einzelpreis ${index + 1}`}
                  {...bind(
                    `lines.${index}.unitPriceMinor`,
                    line.unitPriceMinor,
                  )}
                  onChange={(v) =>
                    update(`lines.${index}.unitPriceMinor`, v, true)
                  }
                  numeric
                />
                <Field
                  label={`Positionssumme ${index + 1}`}
                  {...bind(
                    `lines.${index}.netAmountMinor`,
                    line.netAmountMinor,
                  )}
                  onChange={(v) =>
                    update(`lines.${index}.netAmountMinor`, v, true)
                  }
                  numeric
                />
                <Field
                  label={`Umsatzsteuersatz ${index + 1}`}
                  {...bind(
                    `lines.${index}.vatRateBasisPoints`,
                    line.vatRateBasisPoints,
                  )}
                  onChange={(v) =>
                    update(`lines.${index}.vatRateBasisPoints`, v, false, true)
                  }
                  percentage
                />
                <Button
                  id={`invoice-lines-${index}-remove`}
                  name={`invoice-lines-${index}-remove`}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="col-span-2 mt-1 justify-self-end text-red-700"
                  onClick={() => removeLine(index)}
                >
                  <Trash2 /> Entfernen
                </Button>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="border-b border-stone-200 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Umsatzsteueraufschlüsselung</h2>
          <Button
            id="invoice-vat-add"
            name="invoice-vat-add"
            type="button"
            size="sm"
            variant="outline"
            onClick={addVat}
          >
            <Plus /> Umsatzsteuer hinzufügen
          </Button>
        </div>
        {draft.vatBreakdown.map((vat, index) => (
          <div
            className="mb-3 grid grid-cols-2 gap-2 border-b border-stone-200 pb-3"
            key={index}
          >
            <Field
              label={`Umsatzsteuersatz ${index + 1}`}
              {...bind(
                `vatBreakdown.${index}.rateBasisPoints`,
                vat.rateBasisPoints,
              )}
              onChange={(v) =>
                update(`vatBreakdown.${index}.rateBasisPoints`, v, false, true)
              }
              percentage
            />
            <Field
              label={`Nettobetrag ${index + 1}`}
              {...bind(
                `vatBreakdown.${index}.taxableAmountMinor`,
                vat.taxableAmountMinor,
              )}
              onChange={(v) =>
                update(`vatBreakdown.${index}.taxableAmountMinor`, v, true)
              }
              numeric
            />
            <Field
              label={`Umsatzsteuerbetrag ${index + 1}`}
              {...bind(
                `vatBreakdown.${index}.taxAmountMinor`,
                vat.taxAmountMinor,
              )}
              onChange={(v) =>
                update(`vatBreakdown.${index}.taxAmountMinor`, v, true)
              }
              numeric
            />
            <Button
              id={`invoice-vat-${index}-remove`}
              name={`invoice-vat-${index}-remove`}
              type="button"
              size="sm"
              variant="ghost"
              className="col-span-2 mt-1 justify-self-end text-red-700"
              onClick={() =>
                onChange({
                  ...draft,
                  vatBreakdown: draft.vatBreakdown.filter(
                    (_, vatIndex) => vatIndex !== index,
                  ),
                })
              }
            >
              <Trash2 /> Entfernen
            </Button>
          </div>
        ))}
      </section>
      <Section title="Summen" columns={1}>
        <Field
          label="Nettosumme"
          {...bind('netTotalMinor', draft.netTotalMinor)}
          onChange={(v) => update('netTotalMinor', v, true)}
          onChooseAlternative={(index) =>
            chooseAlternative('netTotalMinor', index)
          }
          compact
          numeric
        />
        <Field
          label="Umsatzsteuer gesamt"
          {...bind('taxTotalMinor', draft.taxTotalMinor)}
          onChange={(v) => update('taxTotalMinor', v, true)}
          onChooseAlternative={(index) =>
            chooseAlternative('taxTotalMinor', index)
          }
          compact
          numeric
        />
        <Field
          label="Bruttosumme"
          {...bind('grossTotalMinor', draft.grossTotalMinor)}
          onChange={(v) => update('grossTotalMinor', v, true)}
          onChooseAlternative={(index) =>
            chooseAlternative('grossTotalMinor', index)
          }
          compact
          numeric
        />
      </Section>
      <Section title="Zahlung">
        <Field
          label="IBAN"
          {...bind('payment.iban', draft.payment.iban)}
          onChange={(v) => update('payment.iban', v)}
        />
        <Field
          label="Verwendungszweck"
          {...bind('payment.reference', draft.payment.reference)}
          onChange={(v) => update('payment.reference', v)}
        />
        <Field
          label="Zahlungsbedingungen"
          {...bind('payment.terms', draft.payment.terms)}
          onChange={(v) => update('payment.terms', v)}
          multiline
        />
      </Section>
    </aside>
  )
}

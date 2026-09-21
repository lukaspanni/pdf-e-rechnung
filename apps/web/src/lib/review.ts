import { validateInvoiceDraft } from '@app/invoice-core'
import type {
  DraftField,
  DraftValidationIssue,
  InvoiceDraft,
} from '@app/invoice-core'

export type ReviewIssue = DraftValidationIssue & { priority: number }

function uncertainFields(value: unknown, path = ''): Array<ReviewIssue> {
  if (!value || typeof value !== 'object') return []
  if ('status' in value) {
    return ['uncertain', 'extracted'].includes(
      (value as DraftField<unknown>).status,
    )
      ? [
          {
            path,
            message:
              (value as DraftField<unknown>).status === 'extracted'
                ? 'Erkannter Wert muss bestätigt oder bearbeitet werden'
                : 'Erkannter Wert muss geprüft werden',
            severity: 'warning',
            priority: 1,
          },
        ]
      : []
  }
  return Object.entries(value).flatMap(([key, child]) =>
    uncertainFields(child, path ? `${path}.${key}` : key),
  )
}

export function buildReviewQueue(draft: InvoiceDraft): Array<ReviewIssue> {
  const issues = [
    ...validateInvoiceDraft(draft).map((issue) => ({
      ...issue,
      priority:
        issue.message === 'Pflichtangabe fehlt'
          ? 0
          : /summe|menge|umsatzsteuer/i.test(issue.message)
            ? 3
            : 2,
    })),
    ...uncertainFields(draft),
  ]
  const unique = new Map<string, ReviewIssue>()
  for (const issue of issues) {
    const existing = unique.get(issue.path)
    if (!existing || issue.priority < existing.priority)
      unique.set(issue.path, issue)
  }
  return [...unique.values()].sort((a, b) => a.priority - b.priority)
}

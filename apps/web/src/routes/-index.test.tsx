import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { runInvoiceExtraction } from '@app/invoice-extraction'
import { Home } from './index'
import type { DocumentModel } from '@app/pdf-core'
import type * as InvoiceExtraction from '@app/invoice-extraction'

vi.mock('@app/invoice-extraction', async (importOriginal) => {
  const actual = await importOriginal<typeof InvoiceExtraction>()
  return {
    ...actual,
    runInvoiceExtraction: vi.fn(actual.runInvoiceExtraction),
  }
})

vi.mock('@/components/pdf-viewer', () => ({
  PdfViewer: ({
    onError,
    onDocumentLoaded,
  }: {
    onError?: () => void
    onDocumentLoaded?: (document: DocumentModel) => void
  }) => {
    useEffect(() => {
      onDocumentLoaded?.({
        pages: [
          {
            number: 1,
            textItems: [{ id: 'invoice-number', text: 'EW-2026-071' }],
          },
        ],
      })
    }, [onDocumentLoaded])
    return (
      <>
        <p>PDF content</p>
        <button type="button" onClick={() => onError?.()}>
          Simulate corrupt PDF
        </button>
      </>
    )
  },
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div role="separator" />,
}))

describe('Home', () => {
  it('saves custom invoice number matching patterns and uses them for extraction', async () => {
    const user = userEvent.setup()
    const storageKey = 'pdf-e-rechnung.settings.v1'
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    render(<Home />)

    await user.click(
      screen.getByRole('button', { name: 'Einstellungen öffnen' }),
    )
    await user.click(screen.getByRole('button', { name: 'Muster hinzufügen' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Regex-Muster 1' }), {
      target: { value: String.raw`\b(EW-\d{4}-\d{3})\b` },
    })
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['pdf'], 'template.pdf', { type: 'application/pdf' }),
    )

    expect(values.get(storageKey)).toContain('EW-\\\\d')
    await waitFor(() =>
      expect(runInvoiceExtraction).toHaveBeenCalledWith(expect.anything(), {
        invoiceNumberPatterns: [String.raw`\b(EW-\d{4}-\d{3})\b`],
      }),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Rechnungsnummer')).toHaveValue(
        'EW-2026-071',
      ),
    )
    vi.unstubAllGlobals()
  })

  it('keeps settings unchanged when a regex is invalid', async () => {
    const user = userEvent.setup()
    render(<Home />)

    await user.click(
      screen.getByRole('button', { name: 'Einstellungen öffnen' }),
    )
    await user.click(screen.getByRole('button', { name: 'Muster hinzufügen' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Regex-Muster 1' }), {
      target: { value: '[' },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ungültiger regulärer Ausdruck.',
    )
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('shows the empty state', () => {
    const { container } = render(<Home />)
    expect(
      screen.getByRole('button', { name: 'PDF öffnen' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Digitale PDF-Datei hier ablegen'),
    ).toBeInTheDocument()
    expect(container.querySelector('#pdf-file')).toHaveAttribute(
      'name',
      'pdf-file',
    )

    const controls = Array.from(
      container.querySelectorAll('input, select, textarea, button'),
    )
    expect(
      controls.every((control) => control.id && control.getAttribute('name')),
    ).toBe(true)
    expect(new Set(controls.map((control) => control.id)).size).toBe(
      controls.length,
    )
  })

  it('shows the selected PDF', async () => {
    const user = userEvent.setup()
    render(<Home />)

    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }),
    )

    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getByText('PDF content')).toBeInTheDocument()
  })

  it('shows a recoverable error when extraction rejects and retries', async () => {
    const user = userEvent.setup()
    const callsBeforeRun = vi.mocked(runInvoiceExtraction).mock.calls.length
    vi.mocked(runInvoiceExtraction).mockRejectedValueOnce(
      new Error('temporary extraction failure'),
    )
    render(<Home />)

    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Rechnung konnte nicht ausgewertet werden.',
    )
    expect(
      screen.queryByText('Rechnung wird ausgewertet …'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    await waitFor(() =>
      expect(runInvoiceExtraction).toHaveBeenCalledTimes(callsBeforeRun + 2),
    )
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    )
  })

  it('replaces the reading pane with a recoverable error for a corrupt PDF', async () => {
    const user = userEvent.setup()
    render(<Home />)

    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['pdf'], 'broken.pdf', { type: 'application/pdf' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Simulate corrupt PDF' }),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Diese PDF-Datei konnte nicht geöffnet werden.',
    )
    expect(
      screen.queryByText('PDF-Text wird gelesen …'),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('alert')).getByRole('button', {
        name: 'Andere PDF öffnen',
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('broken.pdf')).toBeInTheDocument()
  })

  it('allows replacing a corrupt PDF with another file', async () => {
    const user = userEvent.setup()
    render(<Home />)

    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['pdf'], 'broken.pdf', { type: 'application/pdf' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Simulate corrupt PDF' }),
    )
    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['pdf'], 'replacement.pdf', { type: 'application/pdf' }),
    )

    expect(screen.getByText('replacement.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('PDF content')).toBeInTheDocument()
  })

  it('shows an error for a non-PDF file', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<Home />)

    await user.upload(
      screen.getByLabelText('PDF-Datei'),
      new File(['text'], 'notes.txt'),
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bitte wählen Sie eine PDF-Datei aus.',
    )
  })

  it('accepts a PDF dropped on the upload area', () => {
    const { container } = render(<Home />)
    const dropArea = container.querySelector('[class*="border-dashed"]')!

    fireEvent.drop(dropArea, {
      dataTransfer: { files: [new File(['pdf'], 'dropped.pdf')] },
    })

    expect(screen.getByText('dropped.pdf')).toBeInTheDocument()
  })
})

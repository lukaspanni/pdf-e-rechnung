import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createInvoiceDraft } from '@app/invoice-core'
import { InvoiceEditor } from './invoice-editor'

describe('InvoiceEditor', () => {
  it('gives rendered form controls unique ids and names', () => {
    const draft = createInvoiceDraft()
    draft.lines = [
      {
        description: { status: 'missing' },
        quantity: { value: 1, status: 'missing' },
        unitCode: { value: 'C62', status: 'missing' },
        unitPriceMinor: { value: 0, status: 'missing' },
        netAmountMinor: { value: 0, status: 'missing' },
        vatRateBasisPoints: { value: 1900, status: 'missing' },
      },
    ]
    draft.vatBreakdown = [
      {
        rateBasisPoints: { value: 1900, status: 'missing' },
        taxableAmountMinor: { value: 0, status: 'missing' },
        taxAmountMinor: { value: 0, status: 'missing' },
      },
    ]
    draft.grossTotalMinor = {
      value: 0,
      status: 'uncertain',
      alternatives: [{ value: 100, label: '100' }],
    }
    const { container } = render(
      <InvoiceEditor draft={draft} onChange={vi.fn()} />,
    )
    const controls = Array.from(
      container.querySelectorAll('input, select, textarea, button'),
    )
    const ids = controls.map((control) => control.getAttribute('id'))
    const names = controls.map((control) => control.getAttribute('name'))

    expect(controls.length).toBeGreaterThan(0)
    expect(ids.every((id) => Boolean(id))).toBe(true)
    expect(names.every((name) => Boolean(name))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
    expect(
      container.querySelector('#invoice-grossTotalMinor-alternatives'),
    ).toHaveAttribute('name', 'invoice-grossTotalMinor-alternatives')
  })

  it('navigates to field evidence and replaces the selected highlight', () => {
    const draft = createInvoiceDraft()
    draft.number = {
      value: 'OCR-7',
      extractedValue: 'OCR-7',
      status: 'uncertain',
      source: {
        page: 2,
        sourceText: 'Invoice OCR-7',
        sourceItemIds: ['2:3'],
      },
    }
    const viewerController = {
      clearHighlights: vi.fn(),
      highlightSources: vi.fn(),
      scrollToSource: vi.fn(),
    }
    render(
      <InvoiceEditor
        draft={draft}
        onChange={vi.fn()}
        viewerController={viewerController}
      />,
    )

    fireEvent.focus(screen.getByLabelText('Rechnungsnummer'))

    expect(viewerController.highlightSources).toHaveBeenCalledWith([
      draft.number.source,
    ])
    expect(viewerController.scrollToSource).toHaveBeenCalledWith(
      draft.number.source,
    )
    fireEvent.focus(screen.getByLabelText('Rechnungsdatum'))
    expect(viewerController.clearHighlights).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', {
        name: /Details zu Rechnungsnummer: .*Seite 2/,
      }),
    ).not.toHaveAttribute('title')
  })

  it('marks reviewer input as edited and adds a line', () => {
    const draft = createInvoiceDraft()
    const onChange = vi.fn()
    render(<InvoiceEditor draft={draft} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Rechnungsnummer'), {
      target: { value: 'INV-7' },
    })
    expect(onChange.mock.calls[0]?.[0].number).toMatchObject({
      value: 'INV-7',
      status: 'user-edited',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Position hinzufügen' }))
    expect(onChange.mock.calls[1]?.[0].lines).toHaveLength(1)
  })

  it('requires explicit confirmation for extracted values', () => {
    const draft = createInvoiceDraft()
    draft.number = { value: 'INV-8', status: 'extracted' }
    const onChange = vi.fn()
    render(<InvoiceEditor draft={draft} onChange={onChange} />)

    const confirmButton = screen.getByRole('button', { name: 'Bestätigen' })
    expect(confirmButton.closest('label')).toBeNull()
    fireEvent.click(confirmButton)

    expect(onChange.mock.calls[0]?.[0].number).toMatchObject({
      value: 'INV-8',
      status: 'user-confirmed',
    })
  })

  it('keeps a confirmed review item visible and crossed out', () => {
    const draft = createInvoiceDraft()
    draft.number = { value: 'INV-10', status: 'extracted' }
    const onChange = vi.fn()
    render(<InvoiceEditor draft={draft} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }))

    expect(onChange.mock.calls[0]?.[0].number.status).toBe('user-confirmed')
    const completedItem = screen.getByRole('button', {
      name: /Rechnungsnummer: .*erledigt/,
    })
    expect(completedItem.querySelector('.line-through')).toBeInTheDocument()
    expect(completedItem.querySelector('svg')).toHaveClass('text-green-700')
  })

  it('reindexes completed review items when an earlier invoice line is removed', () => {
    const draft = createInvoiceDraft()
    const reviewLine = (description: string) => ({
      description: { value: description, status: 'extracted' as const },
      quantity: { value: 1, status: 'missing' as const },
      unitCode: { value: 'C62', status: 'missing' as const },
      unitPriceMinor: { value: 100, status: 'missing' as const },
      netAmountMinor: { value: 100, status: 'missing' as const },
      vatRateBasisPoints: { value: 1900, status: 'missing' as const },
    })
    draft.lines = [reviewLine('Erste Position'), reviewLine('Zweite Position')]
    const onChange = vi.fn()
    const { container, rerender } = render(
      <InvoiceEditor draft={draft} onChange={onChange} />,
    )

    fireEvent.click(
      container.querySelector(
        '#invoice-lines-1-description-confirm',
      ) as HTMLButtonElement,
    )
    fireEvent.click(
      container.querySelector('#invoice-lines-0-remove') as HTMLButtonElement,
    )
    const updatedDraft = onChange.mock.calls.at(-1)?.[0]
    if (!updatedDraft) throw new Error('Updated invoice draft was not emitted')
    rerender(<InvoiceEditor draft={updatedDraft} onChange={onChange} />)

    expect(
      screen.getByRole('button', {
        name: /Position 1 · Bezeichnung: .*erledigt/,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /Position 2 · Bezeichnung: .*erledigt/,
      }),
    ).not.toBeInTheDocument()
  })

  it('removes completed review items when their invoice line is deleted', () => {
    const draft = createInvoiceDraft()
    draft.lines = [
      {
        description: { value: 'Zu löschen', status: 'extracted' },
        quantity: { value: 1, status: 'missing' },
        unitCode: { value: 'C62', status: 'missing' },
        unitPriceMinor: { value: 100, status: 'missing' },
        netAmountMinor: { value: 100, status: 'missing' },
        vatRateBasisPoints: { value: 1900, status: 'missing' },
      },
    ]
    const onChange = vi.fn()
    const { container, rerender } = render(
      <InvoiceEditor draft={draft} onChange={onChange} />,
    )

    fireEvent.click(
      container.querySelector(
        '#invoice-lines-0-description-confirm',
      ) as HTMLButtonElement,
    )
    fireEvent.click(
      container.querySelector('#invoice-lines-0-remove') as HTMLButtonElement,
    )
    const updatedDraft = onChange.mock.calls.at(-1)?.[0]
    if (!updatedDraft) throw new Error('Updated invoice draft was not emitted')
    rerender(<InvoiceEditor draft={updatedDraft} onChange={onChange} />)

    expect(screen.queryByRole('button', { name: /erledigt/ })).toBeNull()
  })

  it('allows decimal quantities in the editor', () => {
    const draft = createInvoiceDraft()
    draft.lines = [
      {
        description: { value: 'Beratung', status: 'missing' },
        quantity: { value: 1, status: 'missing' },
        unitCode: { value: 'C62', status: 'missing' },
        unitPriceMinor: { value: 200, status: 'missing' },
        netAmountMinor: { value: 200, status: 'missing' },
        vatRateBasisPoints: { value: 1900, status: 'missing' },
      },
    ]
    const onChange = vi.fn()
    render(<InvoiceEditor draft={draft} onChange={onChange} />)
    const quantity = screen.getByLabelText('Menge 1')
    expect(quantity).toHaveAttribute('step', 'any')
    fireEvent.change(quantity, { target: { value: '1.5' } })
    expect(onChange.mock.calls[0]?.[0].lines[0]?.quantity.value).toBe(1.5)
  })

  it('formats VAT rates as percentages while storing basis points', () => {
    const draft = createInvoiceDraft()
    draft.lines = [
      {
        description: { value: 'Beratung', status: 'missing' },
        quantity: { value: 1, status: 'missing' },
        unitCode: { value: 'C62', status: 'missing' },
        unitPriceMinor: { value: 200, status: 'missing' },
        netAmountMinor: { value: 200, status: 'missing' },
        vatRateBasisPoints: { value: 1900, status: 'missing' },
      },
    ]
    const onChange = vi.fn()
    render(<InvoiceEditor draft={draft} onChange={onChange} />)

    const rate = screen.getByLabelText('Umsatzsteuersatz 1')
    expect(rate).toHaveValue('19')
    fireEvent.change(rate, { target: { value: '7,5' } })
    expect(onChange.mock.calls[0]?.[0].lines[0]?.vatRateBasisPoints.value).toBe(
      750,
    )
  })

  it('shows extraction metadata on demand instead of as a label line', () => {
    const draft = createInvoiceDraft()
    draft.number = {
      value: 'INV-9',
      status: 'uncertain',
      extractionMethod: 'deterministic',
      confidence: 'high',
      source: { page: 1, sourceText: 'INV-9', sourceItemIds: ['1:0'] },
    }
    render(<InvoiceEditor draft={draft} onChange={vi.fn()} />)

    expect(
      screen.queryByText(/Deterministisch erkannt/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Details zu Rechnungsnummer: Deterministisch erkannt · Sicherheit: hoch · Seite 1 · INV-9/,
      }),
    ).not.toHaveAttribute('title')
  })

  it('applies a suggested amount and its source to the selected total', () => {
    const draft = createInvoiceDraft()
    draft.netTotalMinor = {
      value: 21008,
      status: 'uncertain',
      alternatives: [
        {
          value: 25210,
          label: 'Summe: · 252,10€',
          source: {
            page: 1,
            sourceText: '252,10€',
            sourceItemIds: ['net'],
          },
        },
      ],
    }
    const onChange = vi.fn()
    render(<InvoiceEditor draft={draft} onChange={onChange} />)

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Nettosumme – weitere erkannte Beträge',
      }),
      { target: { value: '0' } },
    )

    expect(onChange.mock.calls[0]?.[0].netTotalMinor).toMatchObject({
      value: 25210,
      extractedValue: 25210,
      status: 'user-edited',
      source: { sourceItemIds: ['net'] },
    })
  })
})

import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfViewer } from './pdf-viewer'
import type { PdfViewerController } from './pdf-viewer'

const { getPdfLoadingTask } = vi.hoisted(() => ({ getPdfLoadingTask: vi.fn() }))
vi.mock('@/lib/pdf', () => ({ getPdfLoadingTask }))

function loadingTask(pdf = Promise.resolve({ numPages: 1 })) {
  return { destroy: vi.fn(), promise: pdf }
}

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  it('shows its loading state', () => {
    getPdfLoadingTask.mockReturnValue(new Promise(() => {}))
    render(<PdfViewer file={new File([''], 'invoice.pdf')} />)
    expect(screen.getByText('PDF wird geöffnet …')).toBeInTheDocument()
  })

  it('renders page content after PDF.js loads', async () => {
    const renderTask = { cancel: vi.fn(), promise: Promise.resolve() }
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          {
            str: 'Invoice total',
            transform: [1, 0, 0, 1, 10, 20],
            width: 60,
            height: 12,
          },
        ],
      }),
      getViewport: vi.fn().mockReturnValue({
        height: 100,
        width: 80,
        convertToViewportPoint: vi.fn((x: number, y: number) => [x, 100 - y]),
      }),
      render: vi.fn().mockReturnValue(renderTask),
    }
    getPdfLoadingTask.mockResolvedValue(
      loadingTask(
        Promise.resolve({
          cleanup: vi.fn(),
          getPage: vi.fn().mockResolvedValue(page),
          numPages: 1,
        }),
      ),
    )

    const { container } = render(
      <PdfViewer file={new File([''], 'invoice.pdf')} />,
    )

    expect(await screen.findByText('Invoice total')).toBeInTheDocument()
    expect(container.querySelector('canvas')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('highlights all text items referenced by the selected source', async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          {
            str: 'Line one',
            transform: [1, 0, 0, 1, 10, 20],
            width: 30,
            height: 10,
          },
          {
            str: 'Line two',
            transform: [1, 0, 0, 1, 10, 10],
            width: 30,
            height: 10,
          },
        ],
      }),
      getViewport: vi.fn().mockReturnValue({
        height: 100,
        width: 80,
        convertToViewportPoint: vi.fn((x: number, y: number) => [x, 100 - y]),
      }),
      render: vi.fn().mockReturnValue({
        cancel: vi.fn(),
        promise: Promise.resolve(),
      }),
    }
    getPdfLoadingTask.mockResolvedValue(
      loadingTask(
        Promise.resolve({
          cleanup: vi.fn(),
          getPage: vi.fn().mockResolvedValue(page),
          numPages: 1,
        }),
      ),
    )
    const ref = createRef<PdfViewerController>()
    const { container } = render(
      <PdfViewer ref={ref} file={new File([''], 'invoice.pdf')} />,
    )
    await screen.findByText('Line one Line two')

    ref.current!.highlightSources([
      { page: 1, sourceText: '', sourceItemIds: ['1:0', '1:1'] },
    ])

    expect(container.querySelectorAll('[data-source-highlight]')).toHaveLength(
      2,
    )
  })

  it('scales both the page and canvas when zoom changes', async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      getViewport: vi.fn().mockReturnValue({
        height: 100,
        width: 80,
        convertToViewportPoint: vi.fn((x: number, y: number) => [x, 100 - y]),
      }),
      render: vi.fn().mockReturnValue({
        cancel: vi.fn(),
        promise: Promise.resolve(),
      }),
    }
    getPdfLoadingTask.mockResolvedValue(
      loadingTask(
        Promise.resolve({
          cleanup: vi.fn(),
          getPage: vi.fn().mockResolvedValue(page),
          numPages: 1,
        }),
      ),
    )
    render(<PdfViewer file={new File([''], 'invoice.pdf')} />)

    const pageElement = await screen.findByLabelText('Seite 1')
    expect(pageElement).toHaveStyle({ width: '80px', height: '100px' })
    fireEvent.click(screen.getByRole('button', { name: 'PDF vergrößern' }))

    expect(pageElement).toHaveStyle({ width: '88px', height: '110px' })
    expect(pageElement.querySelector('canvas')).toHaveStyle({
      width: '88px',
      height: '110px',
    })
  })

  it('shows its error state when PDF.js rejects the file', async () => {
    getPdfLoadingTask.mockRejectedValue(new Error('broken'))
    const onError = vi.fn()
    render(<PdfViewer file={new File([''], 'invoice.pdf')} onError={onError} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Diese PDF-Datei konnte nicht geöffnet werden.',
    )
    expect(onError).toHaveBeenCalledOnce()
  })

  it('destroys a loaded PDF task on unmount', async () => {
    const task = loadingTask(new Promise(() => {}))
    getPdfLoadingTask.mockResolvedValue(task)
    const { unmount } = render(
      <PdfViewer file={new File([''], 'invoice.pdf')} />,
    )

    await vi.waitFor(() => expect(getPdfLoadingTask).toHaveBeenCalled())
    unmount()

    expect(task.destroy).toHaveBeenCalled()
  })
})

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Minus, Plus } from 'lucide-react'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist'
import type { DocumentModel } from '@app/pdf-core'
import type { PdfViewerController } from '@/lib/pdf-source'
import { getPdfLoadingTask } from '@/lib/pdf'
import { findSourceBoxes, pdfBoxToOverlay } from '@/lib/pdf-source'
import { Button } from '@/components/ui/button'

export type { PdfViewerController } from '@/lib/pdf-source'

type PdfViewerProps = {
  file: File
  onDocumentLoaded?: (document: DocumentModel) => void
  onError?: () => void
}

type PageView = {
  element: HTMLElement
  overlay: HTMLElement
  viewport: ReturnType<
    Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']
  >
}

export const PdfViewer = forwardRef<PdfViewerController, PdfViewerProps>(
  function PdfViewerComponent({ file, onDocumentLoaded, onError }, ref) {
    const pagesRef = useRef<HTMLDivElement>(null)
    const pageViews = useRef(new Map<number, PageView>())
    const modelRef = useRef<DocumentModel>({ pages: [] })
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [zoom, setZoom] = useState(1)
    const zoomRef = useRef(1)
    const [pageCount, setPageCount] = useState(0)
    const [currentPage, setCurrentPage] = useState(1)

    useImperativeHandle(ref, () => ({
      clearHighlights() {
        for (const page of pageViews.current.values())
          page.overlay.replaceChildren()
      },
      highlightSources(sources) {
        for (const page of pageViews.current.values())
          page.overlay.replaceChildren()
        for (const source of sources) {
          const page = pageViews.current.get(source.page)
          if (!page) continue
          for (const box of findSourceBoxes(modelRef.current, source)) {
            const position = pdfBoxToOverlay(box, page.viewport)
            const highlight = document.createElement('span')
            highlight.dataset['sourceHighlight'] = 'true'
            highlight.className =
              'absolute border-2 border-amber-600 bg-amber-300/40'
            Object.assign(highlight.style, {
              left: `${position.left}%`,
              top: `${position.top}%`,
              width: `${position.width}%`,
              height: `${position.height}%`,
            })
            page.overlay.append(highlight)
          }
        }
      },
      scrollToSource(source) {
        const page = pageViews.current.get(source.page)
        const target = page?.overlay.querySelector<HTMLElement>(
          '[data-source-highlight]',
        )
        ;(target ?? page?.element)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      },
    }))

    useEffect(() => {
      const cancellation = new AbortController()
      const isCancelled = () => cancellation.signal.aborted
      let loadingTask: PDFDocumentLoadingTask | undefined
      let document: PDFDocumentProxy | undefined
      let renderTask: RenderTask | undefined
      const model: DocumentModel = { pages: [] }

      async function render() {
        setLoading(true)
        setError(null)

        try {
          const sourcePdf = new Uint8Array(await file.arrayBuffer())
          model.sourcePdf = sourcePdf
          if (isCancelled()) return
          loadingTask = await getPdfLoadingTask(sourcePdf.slice())
          if (isCancelled()) {
            await loadingTask.destroy()
            return
          }

          document = await loadingTask.promise
          setPageCount(document.numPages)
          const container = pagesRef.current
          if (!container || isCancelled()) {
            await loadingTask.destroy()
            return
          }

          container.replaceChildren()
          pageViews.current.clear()
          for (
            let pageNumber = 1;
            pageNumber <= document.numPages;
            pageNumber += 1
          ) {
            const page = await document.getPage(pageNumber)
            if (isCancelled()) return

            const viewport = page.getViewport({ scale: 1.5 })
            const textContent = await page.getTextContent()
            if (isCancelled()) return
            model.pages.push({
              number: pageNumber,
              textItems: textContent.items.flatMap((item, index) => {
                if (!('str' in item)) return []
                const transform = item.transform
                return [
                  {
                    id: `${pageNumber}:${index}`,
                    text: item.str,
                    boundingBox: {
                      x: transform[4],
                      y: transform[5],
                      width: item.width,
                      height: item.height,
                    },
                  },
                ]
              }),
            })

            const pageElement = window.document.createElement('section')
            const canvas = window.document.createElement('canvas')
            const overlay = window.document.createElement('div')
            const context = canvas.getContext('2d')
            canvas.width = viewport.width
            canvas.height = viewport.height
            canvas.setAttribute('aria-hidden', 'true')
            canvas.className = 'block bg-white'
            pageElement.setAttribute('aria-label', `Seite ${pageNumber}`)
            pageElement.className = 'relative mx-auto shrink-0'
            pageElement.dataset['baseWidth'] = String(viewport.width)
            pageElement.dataset['baseHeight'] = String(viewport.height)
            pageElement.style.width = `${viewport.width * zoomRef.current}px`
            pageElement.style.height = `${viewport.height * zoomRef.current}px`
            canvas.style.width = `${viewport.width * zoomRef.current}px`
            canvas.style.height = `${viewport.height * zoomRef.current}px`
            overlay.className = 'pointer-events-none absolute inset-0'
            overlay.setAttribute('aria-hidden', 'true')
            pageElement.append(canvas, overlay)

            const accessibleText = window.document.createElement('p')
            accessibleText.className = 'sr-only'
            accessibleText.textContent = textContent.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' ')
            pageElement.append(accessibleText)

            if (isCancelled()) return
            container.append(pageElement)
            pageViews.current.set(pageNumber, {
              element: pageElement,
              overlay,
              viewport,
            })
            renderTask = page.render({
              canvas,
              canvasContext: context ?? undefined,
              viewport,
            })
            await renderTask.promise
            renderTask = undefined
          }
          modelRef.current = model
          if (!isCancelled()) onDocumentLoaded?.(model)
        } catch {
          if (!isCancelled()) {
            setError('Diese PDF-Datei konnte nicht geöffnet werden.')
            onError?.()
          }
        } finally {
          if (!isCancelled()) setLoading(false)
        }
      }

      void render()
      return () => {
        cancellation.abort()
        renderTask?.cancel()
        void loadingTask?.destroy()
        void document?.cleanup()
      }
    }, [file, onDocumentLoaded, onError])

    useEffect(() => {
      zoomRef.current = zoom
      for (const page of pageViews.current.values()) {
        const width = Number(page.element.dataset['baseWidth'])
        const height = Number(page.element.dataset['baseHeight'])
        page.element.style.width = `${width * zoom}px`
        page.element.style.height = `${height * zoom}px`
        const canvas = page.element.querySelector('canvas')
        if (canvas) {
          canvas.style.width = `${width * zoom}px`
          canvas.style.height = `${height * zoom}px`
        }
      }
    }, [zoom])

    if (error)
      return (
        <p className="p-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )

    const goToPage = (pageNumber: number) => {
      const page = pagesRef.current?.querySelector<HTMLElement>(
        `[aria-label="Seite ${pageNumber}"]`,
      )
      page?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrentPage(pageNumber)
    }

    return (
      <div className="relative flex min-h-full flex-col">
        <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center justify-between border-b border-stone-300 bg-stone-50 px-3">
          <div className="flex items-center gap-1">
            <Button
              id="pdf-page-previous"
              name="pdf-page-previous"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Vorherige Seite"
              disabled={currentPage <= 1}
              onClick={() => goToPage(Math.max(1, currentPage - 1))}
            >
              <span aria-hidden="true">‹</span>
            </Button>
            <span
              className="min-w-16 text-center text-xs tabular-nums text-stone-700"
              aria-live="polite"
            >
              {pageCount ? `${currentPage} / ${pageCount}` : '– / –'}
            </span>
            <Button
              id="pdf-page-next"
              name="pdf-page-next"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Nächste Seite"
              disabled={currentPage >= pageCount}
              onClick={() => goToPage(Math.min(pageCount, currentPage + 1))}
            >
              <span aria-hidden="true">›</span>
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              id="pdf-zoom-out"
              name="pdf-zoom-out"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="PDF verkleinern"
              disabled={zoom <= 0.6}
              onClick={() =>
                setZoom((value) =>
                  Math.max(0.6, Number((value - 0.1).toFixed(1))),
                )
              }
            >
              <Minus />
            </Button>
            <span className="w-10 text-center text-xs tabular-nums text-stone-700">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              id="pdf-zoom-in"
              name="pdf-zoom-in"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="PDF vergrößern"
              disabled={zoom >= 1.5}
              onClick={() =>
                setZoom((value) =>
                  Math.min(1.5, Number((value + 0.1).toFixed(1))),
                )
              }
            >
              <Plus />
            </Button>
          </div>
        </div>
        {loading && (
          <p className="p-6 text-sm text-muted-foreground">
            PDF wird geöffnet …
          </p>
        )}
        <div
          ref={pagesRef}
          className="min-h-0 flex-1 space-y-4 overflow-auto p-4"
          onScroll={(event) => {
            const pages = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                '[aria-label^="Seite "]',
              ),
            )
            const top = event.currentTarget.getBoundingClientRect().top
            const nearest = pages.reduce(
              (best, page, index) => {
                const distance = Math.abs(
                  page.getBoundingClientRect().top - top,
                )
                return distance < best.distance ? { index, distance } : best
              },
              { index: 0, distance: Number.POSITIVE_INFINITY },
            )
            setCurrentPage(nearest.index + 1)
          }}
        />
      </div>
    )
  },
)

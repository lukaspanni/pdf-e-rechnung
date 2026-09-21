import { useCallback, useEffect, useRef, useState } from 'react'
import { FileUp, LoaderCircle, Upload } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { runInvoiceExtraction } from '@app/invoice-extraction'
import { verifyInvoiceDraft } from '@app/invoice-core'
import type { InvoiceDraft, VerifiedInvoice } from '@app/invoice-core'
import type { DocumentModel } from '@app/pdf-core'
import type { DragEvent } from 'react'
import type { PdfViewerController } from '@/lib/pdf-source'
import type { ExtractionSettings } from '@/lib/extraction-settings'
import type { EInvoiceGenerator } from '@/lib/einvoice-generator'
import {
  loadExtractionSettings,
  saveExtractionSettings,
} from '@/lib/extraction-settings'
import { InvoiceEditor } from '@/components/invoice-editor'
import { PdfViewer } from '@/components/pdf-viewer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { validatePdfFile } from '@/lib/pdf'
import { SettingsDialog } from '@/components/settings-dialog'
import { eInvoiceGenerator } from '@/lib/configured-einvoice-generator'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'

export const Route = createFileRoute('/')({ component: Home })

export function Home({
  generator = eInvoiceGenerator,
}: {
  generator?: EInvoiceGenerator
} = {}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const viewerRef = useRef<PdfViewerController>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewerError, setViewerError] = useState(false)
  const [viewerAttempt, setViewerAttempt] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [draft, setDraft] = useState<InvoiceDraft | null>(null)
  const [settings, setSettings] = useState<ExtractionSettings>(
    loadExtractionSettings,
  )
  const [loadedDocument, setLoadedDocument] = useState<DocumentModel | null>(
    null,
  )
  const [extracting, setExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState(false)
  const [extractionRun, setExtractionRun] = useState(0)
  const [narrowWorkspace, setNarrowWorkspace] = useState(false)
  const draftRef = useRef<InvoiceDraft | null>(null)
  draftRef.current = draft
  useEffect(() => {
    const updateLayout = () => setNarrowWorkspace(window.innerWidth < 900)
    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [])
  let verifiedInvoice: VerifiedInvoice | null = null
  if (draft) {
    try {
      verifiedInvoice = verifyInvoiceDraft(draft)
    } catch {
      verifiedInvoice = null
    }
  }
  if (draft) {
    const reviewComplete = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return true
      if ('status' in value) {
        const field = value as { status: string; value?: unknown }
        return !['extracted', 'uncertain'].includes(field.status)
      }
      return Object.values(value).every(reviewComplete)
    }
    if (verifiedInvoice && !reviewComplete(draft)) {
      verifiedInvoice = null
    }
  }

  const extractCandidates = useCallback((document: DocumentModel) => {
    setLoadedDocument(document)
  }, [])

  useEffect(() => {
    if (!loadedDocument) return
    const effect = { active: true }
    setExtracting(true)
    setExtractionError(false)
    void (async () => {
      try {
        const result = await runInvoiceExtraction(loadedDocument, {
          invoiceNumberPatterns: settings.invoiceNumberPatterns,
          ...(draftRef.current ? { existingDraft: draftRef.current } : {}),
        })
        if (effect.active && result.draft) setDraft(result.draft)
      } catch {
        if (effect.active) setExtractionError(true)
      }
    })().finally(() => {
      if (effect.active) setExtracting(false)
    })
    return () => {
      effect.active = false
    }
  }, [loadedDocument, settings.invoiceNumberPatterns, extractionRun])

  const updateSettings = useCallback((next: ExtractionSettings) => {
    saveExtractionSettings(next)
    setSettings(next)
  }, [])

  const handleViewerError = useCallback(() => {
    setViewerError(true)
  }, [])

  function selectFile(candidate: File | undefined) {
    if (!candidate) return
    const validationError = validatePdfFile(candidate)
    if (validationError) {
      setFile(null)
      setError(validationError)
      return
    }

    setError(null)
    setExtractionError(false)
    setViewerError(false)
    setDraft(null)
    draftRef.current = null
    setLoadedDocument(null)
    setFile(candidate)
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    selectFile(event.dataTransfer.files[0])
  }

  async function generateZugferd() {
    if (!file || !verifiedInvoice) return
    setExporting(true)
    setError(null)
    try {
      const pdf = await generator.generate(
        new Uint8Array(await file.arrayBuffer()),
        verifiedInvoice,
      )
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(pdf).buffer], { type: 'application/pdf' }),
      )
      const download = document.createElement('a')
      download.href = url
      download.download = `${file.name.replace(/\.pdf$/i, '')}-zugferd.pdf`
      download.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Der ZUGFeRD-Export ist fehlgeschlagen.',
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="h-dvh overflow-hidden bg-stone-100 text-stone-950">
      <header className="border-b border-stone-300 bg-stone-50">
        <div className="flex h-12 items-center justify-between px-4">
          <h1 className="text-base font-semibold">PDF E-Rechnung</h1>
          <SettingsDialog settings={settings} onSave={updateSettings} />
        </div>
      </header>

      <main className="h-[calc(100dvh-3rem)] w-full overflow-hidden p-3 sm:p-4">
        <input
          id="pdf-file"
          name="pdf-file"
          ref={inputRef}
          className="sr-only"
          aria-label="PDF-Datei"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            selectFile(event.target.files?.[0])
            event.currentTarget.value = ''
          }}
        />

        {!file ? (
          <Card className="mx-auto mt-8 max-w-2xl rounded-md bg-white">
            <CardHeader>
              <CardTitle>PDF öffnen</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="flex min-h-56 flex-col items-center justify-center gap-4 border border-dashed border-stone-400 bg-stone-50 p-6 text-center"
                onDragOver={(event) => event.preventDefault()}
                onDrop={dropFile}
              >
                <FileUp className="size-8 text-stone-600" aria-hidden="true" />
                <p className="text-sm text-stone-700">
                  Digitale PDF-Datei hier ablegen
                </p>
                <Button
                  id="pdf-file-open"
                  name="pdf-file-open"
                  type="button"
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload aria-hidden="true" />
                  PDF öffnen
                </Button>
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-700" role="alert">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <section
            aria-label="PDF-Ansicht"
            className="flex h-full min-h-0 flex-col"
          >
            <div className="mb-2 flex h-9 items-center justify-between gap-3">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <div className="flex shrink-0 items-center gap-2">
                {loadedDocument && (
                  <Button
                    id="retry-extraction"
                    name="retry-extraction"
                    type="button"
                    variant="outline"
                    disabled={extracting}
                    onClick={() => setExtractionRun((run) => run + 1)}
                  >
                    {extracting
                      ? 'Erkennung läuft …'
                      : 'Erkennung erneut ausführen'}
                  </Button>
                )}
                <Button
                  id="pdf-file-change"
                  name="pdf-file-change"
                  type="button"
                  variant="outline"
                  onClick={() => inputRef.current?.click()}
                >
                  Andere PDF öffnen
                </Button>
              </div>
            </div>
            {viewerError ? (
              <div
                className="mt-3 border border-stone-300 bg-white p-6"
                role="alert"
              >
                <p className="text-sm text-red-700">
                  Diese PDF-Datei konnte nicht geöffnet werden.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    id="pdf-retry"
                    name="pdf-retry"
                    type="button"
                    onClick={() => {
                      setViewerError(false)
                      setViewerAttempt((attempt) => attempt + 1)
                    }}
                  >
                    Erneut versuchen
                  </Button>
                  <Button
                    id="pdf-file-change-after-error"
                    name="pdf-file-change-after-error"
                    type="button"
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                  >
                    Andere PDF öffnen
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  <ResizablePanelGroup
                    key={narrowWorkspace ? 'vertical' : 'horizontal'}
                    orientation={narrowWorkspace ? 'vertical' : 'horizontal'}
                    id="invoice-workspace"
                    defaultLayout={
                      narrowWorkspace
                        ? { 'pdf-panel': 50, 'invoice-panel': 50 }
                        : { 'pdf-panel': 62, 'invoice-panel': 38 }
                    }
                    className="h-full min-h-0 min-w-0 overflow-hidden border border-stone-300 bg-white"
                  >
                    <ResizablePanel
                      id="pdf-panel"
                      minSize={narrowWorkspace ? 35 : 45}
                      maxSize={narrowWorkspace ? 65 : 68}
                      className="min-h-0 min-w-0"
                    >
                      <div className="h-full min-w-0 overflow-hidden bg-stone-200">
                        <PdfViewer
                          key={viewerAttempt}
                          ref={viewerRef}
                          file={file}
                          onDocumentLoaded={extractCandidates}
                          onError={handleViewerError}
                        />
                      </div>
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                      id="invoice-panel"
                      minSize={narrowWorkspace ? 35 : 32}
                      maxSize={narrowWorkspace ? 65 : 42}
                      className="min-h-0 min-w-0"
                    >
                      <div className="h-full min-w-0 overflow-hidden">
                        {draft ? (
                          <InvoiceEditor
                            draft={draft}
                            onChange={setDraft}
                            viewerController={viewerRef.current}
                            canGenerate={Boolean(verifiedInvoice)}
                            generating={exporting}
                            onGenerate={() => void generateZugferd()}
                          />
                        ) : (
                          <div className="flex h-full items-start bg-stone-50 p-4">
                            {extractionError ? (
                              <div
                                className="w-full border border-red-300 bg-white p-4 text-sm text-red-800"
                                role="alert"
                              >
                                <p>
                                  Die Rechnung konnte nicht ausgewertet werden.
                                </p>
                                <Button
                                  className="mt-3"
                                  variant="outline"
                                  onClick={() =>
                                    setExtractionRun((run) => run + 1)
                                  }
                                >
                                  Erneut versuchen
                                </Button>
                              </div>
                            ) : (
                              <div
                                className="flex w-full items-center gap-3 border border-stone-300 bg-white px-3 py-3 text-sm text-stone-700"
                                role="status"
                              >
                                <LoaderCircle
                                  className="size-4 animate-spin text-stone-500"
                                  aria-hidden="true"
                                />
                                <span>
                                  {extracting
                                    ? 'Rechnung wird ausgewertet …'
                                    : 'PDF-Text wird gelesen …'}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>
              </>
            )}
          </section>
        )}
        {error && file && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}

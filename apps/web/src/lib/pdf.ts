import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export function validatePdfFile(file: File): string | null {
  if (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  ) {
    return null
  }

  return 'Bitte wählen Sie eine PDF-Datei aus.'
}

export async function getPdfLoadingTask(
  source: File | Uint8Array,
): Promise<PDFDocumentLoadingTask> {
  const data =
    source instanceof Uint8Array
      ? source
      : new Uint8Array(await source.arrayBuffer())
  return getDocument({ data })
}

export async function loadPdf(file: File): Promise<PDFDocumentProxy> {
  return (await getPdfLoadingTask(file)).promise
}

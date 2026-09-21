import { getDocument } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { loadPdf, validatePdfFile } from './pdf'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

describe('validatePdfFile', () => {
  it('accepts PDF MIME types and file extensions', () => {
    expect(
      validatePdfFile(
        new File([''], 'invoice.pdf', { type: 'application/pdf' }),
      ),
    ).toBeNull()
    expect(
      validatePdfFile(new File([''], 'invoice.PDF', { type: '' })),
    ).toBeNull()
  })

  it('rejects non-PDF files', () => {
    expect(
      validatePdfFile(new File([''], 'invoice.txt', { type: 'text/plain' })),
    ).toBe('Bitte wählen Sie eine PDF-Datei aus.')
  })
})

describe('loadPdf', () => {
  it('passes file bytes to PDF.js', async () => {
    const promise = Promise.resolve({ numPages: 1 })
    vi.mocked(getDocument).mockReturnValue({ promise } as never)

    await expect(loadPdf(new File(['pdf'], 'invoice.pdf'))).resolves.toEqual({
      numPages: 1,
    })
    expect(getDocument).toHaveBeenCalledWith({
      data: new Uint8Array([112, 100, 102]),
    })
  })
})

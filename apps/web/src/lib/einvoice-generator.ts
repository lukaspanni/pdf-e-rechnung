import type { VerifiedInvoice } from '@app/invoice-core'

export interface EInvoiceGenerator {
  generate: (pdf: Uint8Array, invoice: VerifiedInvoice) => Promise<Uint8Array>
}

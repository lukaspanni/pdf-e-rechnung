import { app } from '@azure/functions'
import { handleGenerateEInvoiceForm } from '../http/generate-einvoice-endpoint'
import { maxUploadBytes, uploadTooLargeResponse } from '../http/upload-limit'
import { createAzureLogger } from '../platform/azure-cloud-platform'
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from '@azure/functions'

export async function handleGenerateEInvoice(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
    return { status: 413, jsonBody: uploadTooLargeResponse }
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return {
      status: 400,
      jsonBody: {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Expected multipart/form-data.',
        },
      },
    }
  }
  const result = await handleGenerateEInvoiceForm(
    form,
    createAzureLogger(context),
  )
  return {
    status: result.status,
    headers: result.headers,
    ...(result.headers['content-type'] === 'application/json'
      ? { body: result.body as string }
      : { body: Buffer.from(result.body) }),
  }
}

app.http('generateEInvoice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'einvoices/generate',
  handler: handleGenerateEInvoice,
})

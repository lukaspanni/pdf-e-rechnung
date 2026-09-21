import { createServer } from 'node:http'
import { createNodeLogger } from './platform/node-cloud-platform'
import { handleGenerateEInvoiceForm } from './http/generate-einvoice-endpoint'
import { maxUploadBytes, uploadTooLargeResponse } from './http/upload-limit'

export function createLocalServer() {
  return createServer(async (incoming, outgoing) => {
    outgoing.setHeader('access-control-allow-origin', '*')
    if (
      incoming.method !== 'POST' ||
      incoming.url !== '/api/einvoices/generate'
    ) {
      outgoing.writeHead(404).end('Not found')
      return
    }
    const contentType = incoming.headers['content-type']
    if (!contentType?.startsWith('multipart/form-data;')) {
      outgoing.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Expected multipart/form-data.',
          },
        }),
      )
      return
    }

    const contentLength = Number(incoming.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
      outgoing
        .writeHead(413, { 'content-type': 'application/json' })
        .end(JSON.stringify(uploadTooLargeResponse))
      return
    }

    const chunks: Array<Buffer> = []
    let size = 0
    for await (const chunk of incoming) {
      size += chunk.length
      if (size > maxUploadBytes) {
        outgoing
          .writeHead(413, { 'content-type': 'application/json' })
          .end(JSON.stringify(uploadTooLargeResponse))
        return
      }
      chunks.push(Buffer.from(chunk))
    }

    try {
      const request = new Request(`http://localhost${incoming.url}`, {
        method: 'POST',
        headers: incoming.headers as HeadersInit,
        body: Buffer.concat(chunks),
      })
      const form = await request.formData()
      const result = await handleGenerateEInvoiceForm(form, createNodeLogger())
      outgoing.writeHead(result.status, result.headers)
      outgoing.end(result.body)
    } catch (error) {
      console.error('Could not parse multipart request', error)
      outgoing.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Could not parse request body.',
          },
        }),
      )
    }
  })
}

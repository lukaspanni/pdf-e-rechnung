import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { mockInvoice } from '../../../packages/invoice-core/src/mock-invoice'
import { createLocalServer } from '../src/local-server'

describe('local Node API', () => {
  const server = createLocalServer()
  afterEach(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })

  it('generates a ZUGFeRD PDF over real multipart HTTP without Functions tools', async () => {
    const sourcePdf = new Uint8Array(
      await readFile(
        new URL('../../../test-data/sample-invoice.pdf', import.meta.url),
      ),
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing address')
    const form = new FormData()
    form.set(
      'pdf',
      new Blob([sourcePdf], { type: 'application/pdf' }),
      'source.pdf',
    )
    form.set('invoice', JSON.stringify(mockInvoice))

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/einvoices/generate`,
      { method: 'POST', body: form },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    const result = new Uint8Array(await response.arrayBuffer())
    expect(result.slice(0, 5)).toEqual(new Uint8Array([37, 80, 68, 70, 45]))
    expect(result.length).toBeGreaterThan(10_000)
  }, 30_000)

  it('rejects non-multipart HTTP requests', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing address')
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/einvoices/generate`,
      { method: 'POST', body: 'no multipart' },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_REQUEST' },
    })
  })

  it('rejects oversized multipart requests with 413 before buffering', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Missing address')

    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/api/einvoices/generate',
            method: 'POST',
            headers: {
              'content-type': 'multipart/form-data; boundary=test',
              'content-length': 25 * 1024 * 1024 + 1,
            },
          },
          (incoming) => {
            const chunks: Array<Buffer> = []
            incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
            incoming.on('end', () =>
              resolve({
                status: incoming.statusCode ?? 0,
                body: Buffer.concat(chunks).toString(),
              }),
            )
          },
        )
        request.on('error', reject)
        request.end()
      },
    )

    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: 'UPLOAD_TOO_LARGE' },
    })
  })
})

import { createLocalServer } from './local-server'

const port = Number(process.env['PORT'] ?? 7071)
const server = createLocalServer()
server.listen(port, '127.0.0.1', () => {
  console.info(`Local e-invoice API listening on http://localhost:${port}`)
})

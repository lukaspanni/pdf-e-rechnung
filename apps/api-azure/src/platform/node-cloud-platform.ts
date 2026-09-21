import type { Logger } from '@app/einvoice-service'

const logger: Logger = {
  info(message, context) {
    console.info(message, context ?? '')
  },
  error(message, context) {
    console.error(message, context ?? '')
  },
}

export function createNodeLogger(): Logger {
  return logger
}

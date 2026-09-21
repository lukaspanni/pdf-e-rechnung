import type { InvocationContext } from '@azure/functions'
import type { Logger } from '@app/einvoice-service'

class AzureInvocationLogger implements Logger {
  constructor(private readonly context: InvocationContext) {}

  info(message: string, details?: Record<string, unknown>) {
    this.context.info(message, details)
  }

  error(message: string, details?: Record<string, unknown>) {
    this.context.error(message, details)
  }
}

export function createAzureLogger(context: InvocationContext): Logger {
  return new AzureInvocationLogger(context)
}

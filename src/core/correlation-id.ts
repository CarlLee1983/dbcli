export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

let globalCorrelationId: string | undefined

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)
}

export function setGlobalCorrelationId(value: string | undefined): void {
  if (value !== undefined && !isCorrelationId(value)) {
    throw new Error('Invalid correlation ID')
  }
  globalCorrelationId = value
}

export function getGlobalCorrelationId(): string | undefined {
  return globalCorrelationId
}

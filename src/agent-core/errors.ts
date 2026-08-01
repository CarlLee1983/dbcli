/** Configuration error shared by agent-facing command-line tools. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
    if (Error.captureStackTrace) Error.captureStackTrace(this, ConfigError)
  }
}

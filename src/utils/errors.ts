/**
 * Custom error classes for environment parsing and configuration operations
 */

/**
 * Thrown when .env parsing fails
 * Used for: DATABASE_URL parse failures, invalid percent-encoding, missing required DB_* variables
 */
export class EnvParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvParseError'
    // Maintain stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, EnvParseError)
    }
  }
}

/**
 * Thrown when .dbcli configuration read/write or validation fails
 * Used for: .dbcli read/write failures, validation errors, configuration mismatches
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
    // Maintain stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigError)
    }
  }
}

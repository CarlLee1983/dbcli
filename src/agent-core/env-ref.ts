import { ConfigError } from './errors'

export interface EnvReference {
  $env: string
}

/** Resolve a literal or environment reference with a field-specific error. */
export function resolveEnvRef(
  value: string | EnvReference,
  fieldName: string,
  env: Record<string, string | undefined> = process.env
): string {
  if (typeof value === 'string') return value

  const envKey = value.$env
  const resolved = env[envKey]
  if (resolved === undefined) {
    throw new ConfigError(
      `Environment variable not defined: ${envKey} (field: ${fieldName})\n` +
        `Please set ${envKey} in an env file or your environment.`
    )
  }
  return resolved
}

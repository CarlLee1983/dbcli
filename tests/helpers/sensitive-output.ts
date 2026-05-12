import { expect } from 'bun:test'

const DEFAULT_FORBIDDEN_FRAGMENTS = [
  'postgres://user:secret@localhost:5432/app',
  'mysql://user:secret@localhost:3306/app',
  'mongodb+srv://user:secret@example.mongodb.net/app',
  'redis://:secret@localhost:6379/0',
  'ApiKey abc.def.ghi',
  'sk-test-secret',
  'password=secret',
  'token=secret',
  'apiKey=secret',
  'SECRET_ACCESS_KEY',
] as const

export function expectNoSensitiveFragments(
  output: string,
  extraForbidden: readonly string[] = []
): void {
  for (const fragment of [...DEFAULT_FORBIDDEN_FRAGMENTS, ...extraForbidden]) {
    expect(output).not.toContain(fragment)
  }
}

export function expectNoCredentialFieldNames(output: string): void {
  for (const field of ['"host"', '"port"', '"user"', '"password"', '"uri"', '"apiKey"']) {
    expect(output).not.toContain(field)
  }
}

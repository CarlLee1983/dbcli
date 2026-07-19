const SQL_SUBCOMMANDS = new Set(['query', 'export', 'lint'])
const REDACTED_VALUE_FLAGS = new Set([
  '--where',
  '--set',
  '--data',
  '--param',
  '--param-file',
  '--config',
  '--use',
  '--password',
  '--token',
  '--secret',
  '--bulk',
])
const KEEP_VALUE_FLAGS = new Set([
  '--format',
  '--conn-name',
  '--min-severity',
  '--output',
  '--limit',
  '--collection',
  '--index',
])
const LINT_BOOLEAN_FLAGS = new Set(['--no-schema', '--recovery'])

function optionParts(token: string): {
  name: string
  inlineValue: string | undefined
} {
  const equals = token.indexOf('=')
  return equals === -1
    ? { name: token, inlineValue: undefined }
    : { name: token.slice(0, equals), inlineValue: token.slice(equals + 1) }
}

function findSensitiveSubcommand(argv: string[]): {
  index: number
  command: string
} | null {
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index]!
    if (token.startsWith('--')) {
      const { name, inlineValue } = optionParts(token)
      if (
        inlineValue === undefined &&
        (REDACTED_VALUE_FLAGS.has(name) || KEEP_VALUE_FLAGS.has(name))
      ) {
        index++
      }
      continue
    }
    if (SQL_SUBCOMMANDS.has(token)) return { index, command: token }
  }
  return null
}

function sensitiveArgvValues(argv: string[]): string[] {
  const sensitiveCommand = findSensitiveSubcommand(argv)
  const values = new Set<string>()
  let capturedSingleSql = false
  let afterEndOfOptions = false

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (!afterEndOfOptions && token === '--') {
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && token.startsWith('--')) {
      const { name, inlineValue } = optionParts(token)
      if (REDACTED_VALUE_FLAGS.has(name)) {
        const value = inlineValue ?? argv[index + 1]
        if (value) {
          values.add(value)
          if (name === '--bulk') {
            for (const item of value.split(',')) {
              values.add(item)
              if (item.startsWith('@') && item.length > 1) {
                values.add(item.slice(1))
              }
            }
          }
        }
        if (inlineValue === undefined) index++
      } else if (
        inlineValue === undefined &&
        KEEP_VALUE_FLAGS.has(name)
      ) {
        index++
      } else if (
        sensitiveCommand?.command === 'lint' &&
        LINT_BOOLEAN_FLAGS.has(name)
      ) {
        continue
      } else if (!sensitiveCommand || index < sensitiveCommand.index) {
        continue
      } else {
        // Unknown option-shaped tokens after a sensitive command are
        // positional input unless a known option definition proves otherwise.
        values.add(token)
        capturedSingleSql = true
      }
      continue
    }

    if (
      sensitiveCommand &&
      index > sensitiveCommand.index &&
      (sensitiveCommand.command === 'lint' || !capturedSingleSql)
    ) {
      values.add(token)
      capturedSingleSql = true
    }
  }

  return Array.from(values).sort((left, right) => right.length - left.length)
}

/**
 * Sanitize argv into a stable summary suitable for audit logs or recovery envelopes.
 * (Migrated from last-envelope.ts)
 */
export function redactArgv(argv: string[]): string {
  if (argv.length === 0) return '<unknown>'
  const sensitiveCommand = findSensitiveSubcommand(argv)
  const out: string[] = []
  let redactedSingleSql = false
  let afterEndOfOptions = false

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!
    if (!afterEndOfOptions && tok === '--') {
      out.push(tok)
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && tok.startsWith('--')) {
      const { name, inlineValue } = optionParts(tok)
      if (REDACTED_VALUE_FLAGS.has(name)) {
        out.push(`${name} <redacted>`)
        if (inlineValue === undefined) i++
        continue
      }
      if (KEEP_VALUE_FLAGS.has(name)) {
        if (inlineValue !== undefined) {
          out.push(tok)
        } else {
          out.push(name)
          if (i + 1 < argv.length) {
            out.push(argv[++i]!)
          }
        }
        continue
      }
      if (
        sensitiveCommand?.command === 'lint' &&
        LINT_BOOLEAN_FLAGS.has(name)
      ) {
        out.push(tok)
        continue
      }
      if (!sensitiveCommand || i < sensitiveCommand.index) {
        out.push(tok)
        continue
      }
    }
    if (
      sensitiveCommand &&
      i > sensitiveCommand.index &&
      (sensitiveCommand.command === 'lint' || !redactedSingleSql)
    ) {
      out.push('<sql>')
      redactedSingleSql = true
      continue
    }
    out.push(tok)
  }
  return out.join(' ')
}

/** Remove argv-derived sensitive values from an error or diagnostic string. */
export function redactArgvSensitiveText(
  text: string,
  argv: string[]
): string {
  let redacted = text
  for (const value of sensitiveArgvValues(argv)) {
    redacted = redacted.split(value).join('<redacted>')
  }
  return redacted
}

/**
 * Redact sensitive patterns (password=..., token=..., etc.) from arbitrary strings.
 */
export function redactSensitive(text: string): string {
  return text.replace(
    /\b(password|token|apiKey|secret|key|token|auth|credential|pass|pwd|sid)([:=]|\s+)([^\s"';,]+)/gi,
    '$1$2<redacted>'
  )
}

/**
 * Redact sensitive literals from SQL strings (best-effort regex).
 */
export function redactSql(sql: string): string {
  const redacted = sql
    // Redact PostgreSQL dollar-quoted strings: $$...$$ or $tag$...$tag$ (must run
    // before the string/number passes since the body can contain anything).
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "'?'")
    // Redact string literals: '...' or "..."
    .replace(/(['"])(?:(?!\1|\\).|\\.)*\1/g, "'?'")
    // Redact numeric literals
    .replace(/\b\d+(\.\d+)?\b/g, '0')

  return redactSensitive(redacted)
}

/**
 * Recursively redact all values in an object or array.
 */
export function redactParams(params: unknown): unknown {
  if (params === null || params === undefined) return params
  if (Array.isArray(params)) {
    return params.map(redactParams)
  }
  if (typeof params === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(params)) {
      out[key] = redactParams(val)
    }
    return out
  }
  return '<redacted>'
}

const SQL_SUBCOMMANDS = new Set(['query', 'export'])
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
])
const KEEP_VALUE_FLAGS = new Set(['--format', '--conn-name'])

/**
 * Sanitize argv into a stable summary suitable for audit logs or recovery envelopes.
 * (Migrated from last-envelope.ts)
 */
export function redactArgv(argv: string[]): string {
  if (argv.length === 0) return '<unknown>'
  const out: string[] = [argv[0]!]
  if (argv.length === 1) return out.join(' ')

  const sub = argv[1]!
  out.push(sub)

  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i]!
    if (tok.startsWith('--')) {
      const [name, inlineValue] = tok.split('=') as [string, string | undefined]
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
          if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
            out.push(argv[++i]!)
          }
        }
        continue
      }
      out.push(tok)
      continue
    }
    if (i === 2 && SQL_SUBCOMMANDS.has(sub)) {
      out.push('<sql>')
      continue
    }
    out.push(tok)
  }
  return out.join(' ')
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

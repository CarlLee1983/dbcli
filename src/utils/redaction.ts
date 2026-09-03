const SQL_SUBCOMMANDS = new Set(['query', 'export', 'lint', 'assert', 'verify'])
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
  '--query-file',
  '--expect',
  '--vs',
  '--against',
  '--verification-subject',
  '--verification-summary',
  '--evidence-receipt',
  '-f',
])
const KEEP_VALUE_FLAGS = new Set([
  '--format',
  '--conn-name',
  '--min-severity',
  '--output',
  '--limit',
  '--timeout',
  '--collection',
  '--index',
  '--fields',
  '--truncate',
])
const LINT_BOOLEAN_FLAGS = new Set(['--no-schema', '--recovery'])
const QUERY_BOOLEAN_FLAGS = new Set(['--ui', '--no-limit', '--no-truncate', '--recovery'])
const ASSERT_BOOLEAN_FLAGS = new Set(['--no-fail', '--write-verification-artifact'])
const VERIFY_REDACTED_VALUE_FLAGS = new Set([
  '--table',
  '--query',
  '--verify-query',
  '--ddl',
  '--statement',
  '--check',
  '--column',
  '--references',
  '--violation-query',
  '--subject-name',
  '--summary',
  '--baseline',
])
const VERIFY_BOOLEAN_FLAGS = new Set(['--after-write', '--allow-preexisting'])

function optionParts(token: string): {
  name: string
  inlineValue: string | undefined
} {
  if (token.startsWith('-f') && !token.startsWith('--') && token.length > 2) {
    return { name: '-f', inlineValue: token.slice(2) }
  }
  const equals = token.indexOf('=')
  return equals === -1
    ? { name: token, inlineValue: undefined }
    : { name: token.slice(0, equals), inlineValue: token.slice(equals + 1) }
}

function isOptionToken(token: string): boolean {
  return token.startsWith('--') || token.startsWith('-f')
}

function isKnownBooleanFlag(command: string | undefined, name: string): boolean {
  if (command === 'lint') return LINT_BOOLEAN_FLAGS.has(name)
  if (command === 'query') return QUERY_BOOLEAN_FLAGS.has(name)
  if (command === 'assert') return ASSERT_BOOLEAN_FLAGS.has(name)
  if (command === 'verify') return VERIFY_BOOLEAN_FLAGS.has(name)
  return false
}

function isRedactedValueFlag(command: string | undefined, name: string): boolean {
  return (
    REDACTED_VALUE_FLAGS.has(name) ||
    (command === 'verify' && VERIFY_REDACTED_VALUE_FLAGS.has(name))
  )
}

function findSensitiveSubcommand(argv: string[]): {
  index: number
  command: string
} | null {
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index]!
    if (isOptionToken(token)) {
      const { name, inlineValue } = optionParts(token)
      if (
        inlineValue === undefined &&
        (isRedactedValueFlag(undefined, name) || KEEP_VALUE_FLAGS.has(name))
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
  let verifyScenarioSeen = false
  let afterEndOfOptions = false

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (!afterEndOfOptions && token === '--') {
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && isOptionToken(token)) {
      const { name, inlineValue } = optionParts(token)
      if (isRedactedValueFlag(sensitiveCommand?.command, name)) {
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
      } else if (inlineValue === undefined && KEEP_VALUE_FLAGS.has(name)) {
        index++
      } else if (isKnownBooleanFlag(sensitiveCommand?.command, name)) {
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
      sensitiveCommand?.command === 'verify' &&
      index > sensitiveCommand.index &&
      !verifyScenarioSeen
    ) {
      verifyScenarioSeen = true
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
  let verifyScenarioSeen = false
  let afterEndOfOptions = false

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!
    if (!afterEndOfOptions && tok === '--') {
      out.push(tok)
      afterEndOfOptions = true
      continue
    }
    if (!afterEndOfOptions && isOptionToken(tok)) {
      const { name, inlineValue } = optionParts(tok)
      if (isRedactedValueFlag(sensitiveCommand?.command, name)) {
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
      if (isKnownBooleanFlag(sensitiveCommand?.command, name)) {
        out.push(tok)
        continue
      }
      if (!sensitiveCommand || i < sensitiveCommand.index) {
        out.push(tok)
        continue
      }
    }
    if (
      sensitiveCommand?.command === 'verify' &&
      i > sensitiveCommand.index &&
      !verifyScenarioSeen
    ) {
      out.push(tok)
      verifyScenarioSeen = true
      continue
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
export function redactArgvSensitiveText(text: string, argv: string[]): string {
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
  return (
    text
      // URL 的 userinfo：`https://elastic:hunter2@host:9243`。keyword=value 的
      // 規則一個字元都吃不到它，而連線字串常常就是這樣寫的——ES 連線失敗的
      // 錯誤訊息把整串 baseUrl 帶進 audit 的 error 欄。
      // `[^/\s]*@` 而不是 `[^/@\s]+@`：貪婪到 authority 段的**最後**一個 `@`。
      // 密碼裡含字面 `@` 時，停在第一個會把尾巴留在紀錄裡。`[^/\s]` 保證不會
      // 越過 authority 段，所以路徑裡的 `@`（文件 id）不受影響。
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1<redacted>@')
      .replace(
        /\b(password|token|apiKey|secret|key|token|auth|credential|pass|pwd|sid)([:=]|\s+)([^\s"';,]+)/gi,
        '$1$2<redacted>'
      )
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

/**
 * 把控制字元換成可見的跳脫寫法，供任何要把使用者可控字串印給人看的地方使用。
 *
 * C0 與 DEL 之外還涵蓋：雙向控制字元（U+202E 之類，會讓其後整段以右到左顯示，
 * 足以把一行訊息重排成另一個意思）、U+2028／U+2029／U+0085（在多數終端機與
 * 編輯器裡就是換行）、零寬字元（讓兩個看起來相同的字串其實不同）。
 *
 * 這不是排版問題：`ESC[2K ESC[1G` 會清掉整行並把游標移回行首，於是使用者自己
 * 寫進路徑裡的字元可以蓋掉一句「Refused」，讓操作者看到一則假的成功訊息。
 */
export function escapeControlCharacters(text: string): string {
  // The control characters are the subject, not an accident: this function
  // exists to make them visible, so a rule that forbids naming them in a
  // pattern has nothing to warn about here.
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g,
    (char) => {
      const named: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }
      return named[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    }
  )
}

/** How much redacted text may reach the terminal in one message. */
const DISPLAY_CAP = 300

/**
 * Redact a message before it is shown to a person: strip the literal secrets
 * the caller collected, apply the shared credential patterns, make control
 * characters visible, and bound the result.
 *
 * The literal pass exists because a driver is free to quote a credential in
 * prose ("authentication failed for hunter2"), where no keyword or URI pattern
 * can find it. Everything else goes through `redactSensitive`, so there is one
 * credential boundary rather than one per engine.
 */
export function redactSecretsForDisplay(
  text: string,
  secrets: readonly string[],
  maxLen = DISPLAY_CAP
): string {
  let redacted = text
  for (const value of [...secrets].sort((left, right) => right.length - left.length)) {
    // An empty or blank secret matches everywhere; an unauthenticated
    // connection would otherwise have its whole error replaced.
    if (value.trim().length === 0) continue
    redacted = redacted.split(value).join('<redacted>')
  }

  redacted = escapeControlCharacters(redactSensitive(redacted))
  return redacted.length <= maxLen ? redacted : `${redacted.slice(0, maxLen - 1)}…`
}

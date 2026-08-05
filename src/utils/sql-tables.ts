/**
 * Enumerate every table a SQL statement references.
 *
 * The blacklist decides whether a statement may run, and which columns may be
 * returned, from this list. A single-match regex answers "the first table" —
 * which is not a security answer, because a `JOIN`, a comma, or a `UNION`
 * branch reaches a table the first match never names (issue #23).
 *
 * Design bias: fail closed. Where the grammar is ambiguous — a CTE name, a
 * derived-table alias — this reports the identifier rather than dropping it.
 * An extra name can only block more; a missing name discloses data.
 *
 * This is not a SQL parser and does not try to be one. It is a token scanner
 * that recognises the positions in which a table name can appear, so that
 * every such position is reported instead of only the first.
 */

import { dollarQuoteDelimiterAt } from './sql-lexical'

export type SqlTablesDialect = 'postgresql' | 'mysql' | 'mariadb'

export interface ExtractTableReferencesOptions {
  dialect?: SqlTablesDialect
}

/**
 * Keywords that introduce one or more table references.
 *
 * `USING` is here for `DELETE FROM a USING b` and `MERGE INTO a USING b`. It
 * also spells a JOIN's column list (`JOIN b USING (id)`), which is harmless:
 * that form is followed by `(`, where no name is read.
 */
const TABLE_INTRODUCERS = new Set([
  'FROM',
  'JOIN',
  'INTO',
  'UPDATE',
  'TABLE',
  'TRUNCATE',
  'COPY',
  'USING',
  'STRAIGHT_JOIN',
])

/**
 * Noise that may sit between the introducer and the table name.
 * `FROM ONLY t` and `JOIN LATERAL (...)` are the PostgreSQL cases; `TABLE` is
 * optional in `TRUNCATE TABLE t` and required in `LOAD DATA … INTO TABLE t`.
 */
const PRE_TABLE_NOISE = new Set(['ONLY', 'LATERAL', 'TABLE'])

/**
 * Keywords that open a subquery rather than a table list after `FROM (`.
 * The scan finds the tables inside them on its own pass, so reading one as a
 * name would invent a table called `select`.
 */
const SUBQUERY_OPENERS = new Set(['SELECT', 'WITH', 'VALUES', 'TABLE'])

/** `AS` before a table alias. Hoisted so the walk does not rebuild it per row. */
const AS_KEYWORD = new Set(['AS'])

/**
 * Keywords that may follow a table reference. Anything else in that position
 * is an alias, and an alias may be followed by a comma that continues the
 * table list — which is how `FROM orders o, users u` stays visible.
 */
const POST_TABLE_KEYWORDS = new Set([
  'AS',
  'ON',
  'USING',
  'WHERE',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'FETCH',
  'WINDOW',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'OUTER',
  'CROSS',
  'NATURAL',
  'STRAIGHT_JOIN',
  'SET',
  'VALUES',
  'SELECT',
  'RETURNING',
  'FOR',
  'INTO',
  'PARTITION',
  'WITH',
  'TABLESAMPLE',
  'FORCE',
  'IGNORE',
  'USE',
])

/**
 * Words the second pass does not report as possible table names.
 *
 * This is the one place the enumeration can fail *open*: a word wrongly in this
 * set makes a table with that name invisible. So the bar is that the word is
 * reserved — unusable as an unquoted table name — in PostgreSQL *and* MySQL
 * *and* MariaDB simultaneously. That rules out `FILTER`, `PARTITION`, `SET`,
 * `CURRENT`, `UPDATE`, `DELETE`, `INSERT`, `NULLS`, `OVER`, `EXISTS` and the
 * dialect-specific operators (`RLIKE`, `XOR`, `ILIKE`, `STRAIGHT_JOIN`), every
 * one of which is a legal unquoted table name somewhere. A word left out only
 * costs an extra candidate name, which withholds data. A quoted identifier is
 * never filtered, so `FROM "select"` is reported whatever this set says.
 */
const RESERVED_KEYWORDS = new Set([
  'ALL',
  'AND',
  'AS',
  'ASC',
  'CASE',
  'CROSS',
  'DESC',
  'DISTINCT',
  'ELSE',
  'FALSE',
  'FOR',
  'FROM',
  'GROUP',
  'HAVING',
  'IN',
  'INNER',
  'INTO',
  'IS',
  'JOIN',
  'LEFT',
  'LIKE',
  'LIMIT',
  'NOT',
  'NULL',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  // BETWEEN is a col_name_keyword in PostgreSQL, which ColId admits;
  // EXCEPT/INTERSECT became reserved in MySQL only at 8.0.31 and MariaDB 10.3.
  // All three are therefore legal unquoted table names somewhere.
  'RIGHT',
  'SELECT',
  'THEN',
  'TRUE',
  'UNION',
  'USING',
  'VALUES',
  'WHEN',
  'WHERE',
  'WITH',
])

interface Token {
  /** Identifier text with quotes removed, or the raw punctuation character. */
  value: string
  kind: 'identifier' | 'punctuation'
  /** A quoted identifier is never a keyword, however it is spelled. */
  quoted: boolean
}

const IDENTIFIER_START = /[A-Za-z_-￿]/
const IDENTIFIER_PART = /[A-Za-z0-9_$-￿]/

/**
 * Tokenize far enough to locate table names: identifiers (bare or quoted),
 * `.` `,` `(` `)` `;` as structure, everything else discarded.
 *
 * Comments and string literals are skipped so their contents cannot be read as
 * table references. Quoted *identifiers* are kept — unlike the permission
 * guard's stripper, which erases them, because here the identifier is the
 * answer. Double quotes and backticks are treated as identifier quotes in
 * every dialect: reading a MySQL `"users"` string as an identifier reports one
 * table too many, which blocks rather than discloses.
 */
function tokenize(
  sql: string,
  dialect: SqlTablesDialect | undefined,
  backslashEscapes: boolean
): Token[] {
  const tokens: Token[] = []
  const mysqlDialect = dialect === 'mysql' || dialect === 'mariadb'
  let i = 0

  while (i < sql.length) {
    const char = sql[i] as string

    // Line comment: `--` to end of line. MySQL/MariaDB require whitespace after
    // the second dash, so without it the text stays executable and visible.
    const dashFollowerCode = sql.charCodeAt(i + 2)
    if (
      char === '-' &&
      sql[i + 1] === '-' &&
      (!mysqlDialect ||
        sql[i + 2] === undefined ||
        dashFollowerCode <= 0x20 ||
        dashFollowerCode === 0x7f)
    ) {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }

    // MySQL/MariaDB `#` line comment. Not a comment in PostgreSQL, so skipping
    // it there would hide executable text.
    if (mysqlDialect && char === '#') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }

    // Block comment. PostgreSQL nests them.
    if (char === '/' && sql[i + 1] === '*') {
      // MySQL/MariaDB *execute* `/*! … */` and `/*M! … */`. Skipping them as
      // comments would hide a table the server still reads.
      if (mysqlDialect && (sql.startsWith('/*!', i) || sql.startsWith('/*M!', i))) {
        const prefixLength = sql.startsWith('/*M!', i) ? 4 : 3
        const closingIndex = sql.indexOf('*/', i + prefixLength)
        const bodyEnd = closingIndex === -1 ? sql.length : closingIndex
        // An immediately adjacent version number is comment metadata, not SQL.
        const body = sql.slice(i + prefixLength, bodyEnd).replace(/^\d+/, ' ')
        tokens.push(...tokenize(body, dialect, backslashEscapes))
        i = closingIndex === -1 ? sql.length : closingIndex + 2
        continue
      }
      const nests = dialect === 'postgresql'
      let depth = 1
      i += 2
      while (i < sql.length && depth > 0) {
        if (nests && sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
          continue
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
          continue
        }
        i++
      }
      continue
    }

    // PostgreSQL dollar-quoted string. Only opens at a token boundary, since
    // `a$q$` is one identifier rather than `a` followed by a quote.
    if (dialect === 'postgresql' && char === '$') {
      const delimiter = dollarQuoteDelimiterAt(sql, i)
      if (delimiter) {
        i += delimiter.length
        const closingIndex = sql.indexOf(delimiter, i)
        i = closingIndex === -1 ? sql.length : closingIndex + delimiter.length
        continue
      }
    }

    // String literal. Doubled quotes always escape; whether a backslash does is
    // server- and mode-dependent, so `backslashEscapes` is not a guess — the
    // caller runs the scan under BOTH readings and unions the results. Picking
    // one would be unsafe in both directions: assuming an escape lets `'a\'`
    // hide a FROM clause, and refusing one flips quote parity so that the next
    // literal runs to end of input and hides the rest of the statement.
    if (char === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2
            continue
          }
          i++
          break
        }
        if (backslashEscapes && sql[i] === '\\') {
          i += 2
          continue
        }
        i++
      }
      continue
    }

    // Quoted identifier: "name" or `name`. Doubled quote escapes.
    if (char === '"' || char === '`') {
      const quote = char
      i++
      let value = ''
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            value += quote
            i += 2
            continue
          }
          i++
          break
        }
        if (backslashEscapes && sql[i] === '\\') {
          value += sql[i + 1] ?? ''
          i += 2
          continue
        }
        value += sql[i]
        i++
      }
      tokens.push({ value, kind: 'identifier', quoted: true })
      continue
    }

    // Bare identifier or keyword.
    if (IDENTIFIER_START.test(char)) {
      let value = ''
      while (i < sql.length && IDENTIFIER_PART.test(sql[i] as string)) {
        value += sql[i]
        i++
      }
      tokens.push({ value, kind: 'identifier', quoted: false })
      continue
    }

    if (char === '.' || char === ',' || char === '(' || char === ')' || char === ';') {
      tokens.push({ value: char, kind: 'punctuation', quoted: false })
      i++
      continue
    }

    i++
  }

  return tokens
}

function isKeyword(token: Token | undefined, keywords: Set<string>): boolean {
  if (!token || token.kind !== 'identifier' || token.quoted) return false
  return keywords.has(token.value.toUpperCase())
}

function isPunctuation(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punctuation' && token.value === value
}

/**
 * Read a possibly qualified name (`a`, `a.b`, `a.b.c`) starting at `index`.
 * Returns the parts and the index just past the name, or null when the
 * position does not hold a name at all.
 */
function readQualifiedName(
  tokens: Token[],
  index: number
): { parts: string[]; next: number } | null {
  const first = tokens[index]
  if (!first || first.kind !== 'identifier') return null

  const parts = [first.value]
  let cursor = index + 1
  while (isPunctuation(tokens[cursor], '.') && tokens[cursor + 1]?.kind === 'identifier') {
    parts.push((tokens[cursor + 1] as Token).value)
    cursor += 2
  }
  return { parts, next: cursor }
}

/**
 * Decoded spellings of a quoted identifier.
 *
 * PostgreSQL's `U&"\\0073ecrets"` names the table `secrets`, and `UESCAPE` lets
 * almost any character stand in for the backslash — anything that is not a hex
 * digit, `+`, a quote, or whitespace. That includes ordinary letters, so
 * `U&"x0073ecrets" UESCAPE 'x'` leaves the identifier entirely alphanumeric.
 * Rather than parse the `UESCAPE` clause, every character that could legally be
 * the escape is tried and each result added as another candidate — extra
 * candidates only withhold data.
 */
const ANY_ESCAPE_SEQUENCE = /([^0-9a-fA-F+'"\s])(?:\+([0-9a-fA-F]{6})|([0-9a-fA-F]{4}))/g

function decodedVariants(value: string): string[] {
  // One pass decodes every eligible escape character at once, so the cost is
  // linear in the length of the identifier rather than in the number of
  // distinct characters it contains — building a regex per distinct character
  // made a 40 KB identifier take 3.4 seconds.
  const decoded = value.replace(ANY_ESCAPE_SEQUENCE, (whole, _escape, long, short) =>
    fromCodePointOrRaw((long ?? short) as string, whole)
  )
  return decoded === value ? [] : [decoded]
}

/**
 * A code point above the Unicode maximum is not a valid escape — `\+FFFFFF`
 * appears in ordinary Windows paths inside MySQL strings, and letting
 * `String.fromCodePoint` throw took the whole scan down with it.
 */
function fromCodePointOrRaw(hex: string, whole: string): string {
  const codePoint = parseInt(hex, 16)
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole
}

/**
 * Every table referenced by `sql`, deduplicated case-insensitively.
 *
 * A schema-qualified reference yields both forms — `public.users` reports
 * `users` and `public.users` — because a blacklist entry may be written either
 * way and a name that matches neither is not blocked.
 *
 * The scan is run under every reading of the ambiguous lexical rules and the
 * results are unioned: whether a backslash escapes a quote is server- and
 * mode-dependent, and when no dialect is given the comment rules differ too.
 * Choosing one reading is what let a crafted literal desynchronise the scanner
 * and hide the rest of the statement.
 */
export function extractTableReferences(
  sql: string,
  options: ExtractTableReferencesOptions = {}
): string[] {
  const seen = new Set<string>()
  const references: string[] = []

  const record = (name: string): void => {
    const key = name.toLowerCase()
    if (name.length === 0 || seen.has(key)) return
    seen.add(key)
    references.push(name)
  }

  const dialects: (SqlTablesDialect | undefined)[] = options.dialect
    ? [options.dialect]
    : ['postgresql', 'mysql', undefined]
  for (const dialect of dialects) {
    for (const backslashEscapes of [false, true]) {
      collectReferences(tokenize(sql, dialect, backslashEscapes), record)
    }
  }

  return references
}

/** Record every name the token stream can hold. */
function collectReferences(tokens: Token[], record: (name: string) => void): void {
  const recordName = (parts: string[]): void => {
    const bare = parts[parts.length - 1] as string
    record(bare)
    for (const variant of decodedVariants(bare)) record(variant)
    if (parts.length > 1) record(parts.join('.'))
  }

  let i = 0
  while (i < tokens.length) {
    if (!isKeyword(tokens[i], TABLE_INTRODUCERS)) {
      i++
      continue
    }

    // `INSERT INTO`, `SELECT … INTO`, `FROM`, `JOIN`, `UPDATE`, `TRUNCATE TABLE`.
    const introducer = (tokens[i] as Token).value.toUpperCase()
    // Only a FROM/JOIN position can hold a set-returning function; after
    // `INSERT INTO log (a)` the paren is a column list and `log` is the table.
    const parenMeansFunction = introducer === 'FROM' || introducer === 'JOIN'
    let cursor = i + 1
    while (isKeyword(tokens[cursor], PRE_TABLE_NOISE)) cursor++

    // `FROM ( … )` is either a derived table — whose inner FROM the outer scan
    // finds on its own — or a parenthesised join, whose left-hand table is
    // introduced by nothing but the paren. Descend so that one is not missed.
    // Only in a FROM/JOIN position: after `USING` a paren is a column list.
    while (
      parenMeansFunction &&
      isPunctuation(tokens[cursor], '(') &&
      !isKeyword(tokens[cursor + 1], SUBQUERY_OPENERS) &&
      tokens[cursor + 1]?.kind === 'identifier'
    ) {
      cursor++
    }

    // A table list: one reference, then optionally an alias, then a comma
    // continuing the list.
    let expectTable = true
    while (expectTable) {
      expectTable = false
      const name = readQualifiedName(tokens, cursor)
      if (!name) break

      // `FROM generate_series(1, 10)` is a function call, not a table.
      const isFunctionCall = parenMeansFunction && isPunctuation(tokens[name.next], '(')
      if (!isFunctionCall) recordName(name.parts)

      cursor = name.next
      if (isFunctionCall) break

      // Skip an alias, with or without AS, before deciding whether the list
      // continues. A keyword in that position ends the list instead.
      if (isKeyword(tokens[cursor], AS_KEYWORD)) cursor++
      if (
        tokens[cursor]?.kind === 'identifier' &&
        !isKeyword(tokens[cursor], POST_TABLE_KEYWORDS)
      ) {
        cursor++
      }

      // Decoration between a table reference and the comma that continues the
      // list: a column alias list (`t (a, b)`), an index hint
      // (`USE INDEX (i)`), a partition selector, `TABLESAMPLE bernoulli(1)`.
      // Skip the balanced group and keep walking — stopping here would drop
      // every remaining entry of the list, which is how `FROM a USE INDEX (i),
      // secrets` used to hide `secrets`.
      while (isPunctuation(tokens[cursor], '(')) {
        let depth = 0
        do {
          if (isPunctuation(tokens[cursor], '(')) depth++
          else if (isPunctuation(tokens[cursor], ')')) depth--
          cursor++
        } while (depth > 0 && cursor < tokens.length)
        // A hint may be followed by another identifier before the comma.
        if (
          tokens[cursor]?.kind === 'identifier' &&
          !isKeyword(tokens[cursor], POST_TABLE_KEYWORDS)
        )
          cursor++
      }

      if (isPunctuation(tokens[cursor], ',')) {
        cursor++
        expectTable = true
      }
    }

    i = Math.max(cursor, i + 1)
  }

  // Second pass, and the reason this function can be relied on: every
  // identifier that is not a known SQL keyword is reported as well.
  //
  // The positional walk above is precise but finite — three adversarial review
  // rounds each found new grammar corners it did not cover (`{ oj … }`,
  // `STRAIGHT_JOIN`, `ANALYZE t`, `CREATE INDEX … ON t`, `U&"t"`), and the
  // pattern is the one recorded for 1.47.1: a keyword-matching guard has a
  // ceiling, and stacking exceptions onto it does not reach the top. So the
  // guarantee does not rest on the walk being complete. It rests on this:
  // a table name is an identifier, and every identifier is reported.
  //
  // The cost is over-reporting — a column, alias, or function name that
  // happens to equal a blacklisted table's name will block the statement or
  // mask that table's columns. That is the direction that withholds data.
  //
  // Walked once, tracking dotted chains as it goes: calling readQualifiedName
  // at every index made a long `a.a.a…` chain quadratic.
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (!token || token.kind !== 'identifier') {
      index++
      continue
    }
    const name = readQualifiedName(tokens, index) as { parts: string[]; next: number }
    for (let part = 0; part < name.parts.length; part++) {
      const value = name.parts[part] as string
      const isQuoted = (tokens[index + part * 2] as Token | undefined)?.quoted === true
      if (isQuoted || !RESERVED_KEYWORDS.has(value.toUpperCase())) {
        record(value)
        for (const variant of decodedVariants(value)) record(variant)
      }
    }
    if (name.parts.length > 1) record(name.parts.join('.'))
    index = name.next
  }
}

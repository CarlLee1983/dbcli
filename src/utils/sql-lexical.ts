/**
 * Lexical rules shared by every SQL scanner in dbcli.
 *
 * The permission guard and the table enumerator both have to decide where a
 * comment, a string, or a dollar-quote starts and ends. They disagree on what
 * to *emit* — the guard erases quoted identifiers, the enumerator keeps them —
 * but they must never disagree on *where the boundaries are*. When they did,
 * the difference was a bypass: the same dollar-quote rule was corrected in one
 * file and not the other three separate times.
 *
 * So the boundary rules live here, and both import them.
 */

/**
 * A character that can continue a PostgreSQL identifier. Its lexer accepts any
 * high byte (`ident_cont` is `[A-Za-z\200-\377_0-9$]`), so accented and
 * non-Latin letters count — `café$q$` is one identifier, not `café` followed by
 * a dollar-quote. Treating a character as part of an identifier only ever makes
 * the analysis stricter, since fewer regions get stripped from view.
 */
export const IDENTIFIER_CONTINUATION = /[A-Za-z0-9_$]|[-￿]/

/** A character that can *begin* a PostgreSQL identifier — not a digit, not `$`. */
export const IDENTIFIER_START = /[A-Za-z_]|[\u0080-\uFFFF]/

/**
 * A PostgreSQL dollar-quote delimiter: `$$` or `$tag$`.
 *
 * The tag "follows the rules for an unquoted identifier", which admits high
 * bytes just as `IDENTIFIER_CONTINUATION` does. An ASCII-only pattern does not
 * merely miss `$é$ … $é$` — it leaves the quoted body visible, so a `'` inside
 * it opens a literal that runs to end of input and hides everything after it,
 * including a stacked `DELETE`. Failing to recognise a quote is not the safe
 * direction here; it desynchronises the scan.
 */
export const DOLLAR_QUOTE_DELIMITER =
  /^\$(?:(?:[A-Za-z_]|[-￿])(?:[A-Za-z0-9_]|[-￿])*)?\$/

/**
 * The dollar-quote delimiter opening at `index`, or undefined.
 *
 * A dollar-quote only opens at a token boundary: PostgreSQL identifiers may
 * contain `$` from the second character on, so in `SELECT 1 AS a$q$` the `$q$`
 * belongs to the identifier and quotes nothing.
 */
export function dollarQuoteDelimiterAt(sql: string, index: number): string | undefined {
  if (sql[index] !== '$') return undefined
  if (continuesIdentifier(sql, index)) return undefined
  return sql.slice(index).match(DOLLAR_QUOTE_DELIMITER)?.[0]
}

/**
 * Whether the `$` at `index` continues the identifier before it.
 *
 * Only an *identifier* absorbs a following `$`. A numeric literal does not, so
 * `1$q$` is a number followed by a real dollar quote while `a1$q$` is one
 * identifier. Testing only the immediately preceding character cannot tell
 * those apart, so the run of identifier characters is walked back to its first
 * character: a letter or `_` starts an identifier, a digit starts a number.
 */
function continuesIdentifier(sql: string, index: number): boolean {
  let start = index
  while (start > 0 && IDENTIFIER_CONTINUATION.test(sql[start - 1] ?? '')) start--
  if (start === index) return false

  const run = sql.slice(start, index)
  const first = run[0] as string

  // An identifier absorbs the `$`.
  if (IDENTIFIER_START.test(first)) return true
  // `$1` is a positional parameter, and the `$q$` after it is a real quote.
  if (first === '$') return false

  // A digit starts a *number*, and PostgreSQL lexes an adjacent identifier as a
  // separate token: `1a$q$` is `1` followed by the identifier `a$q$`, so the
  // `$` is absorbed, while `1e5$q$` is one numeric literal followed by a real
  // quote. Testing only the first character called both of them numbers, which
  // invented a dollar quote in `SELECT 1a$q$ ; DELETE … ; SELECT 1 AS z$q$` and
  // hid the DELETE from the permission guard.
  return run.replace(/^[0-9]+(?:[eE][0-9]+)?/, '').length > 0
}

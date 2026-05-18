/**
 * POSIX shell-quote a value before splicing it into an agent-runnable command.
 *
 * Identifiers built from a safe character set are returned untouched so simple
 * cases like `dbcli use staging` stay readable. Anything else is wrapped in
 * single quotes (with embedded single quotes escaped via the standard
 * `'\''` dance) so a hostile table / snippet / hint name cannot break out and
 * inject a follow-on shell command.
 */
export function shellQuote(value: string): string {
  if (value.length === 0) return "''"
  if (/^[A-Za-z0-9_./@:+,=-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

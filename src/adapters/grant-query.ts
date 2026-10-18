import {
  extractMariaDBVersion,
  isMariaDBVersion,
  parseVersionSegments,
} from '@/utils/db-version-check'
import { ConnectionError } from './types'

type Dialect = 'mysql' | 'mariadb'

function unsafeInput(): never {
  throw new ConnectionError(
    'UNKNOWN',
    'Cannot safely classify conditional SHOW GRANTS without unambiguous server-version information.',
    ['Use an explicit SHOW GRANTS statement without conditional comments']
  )
}

function versionNumber(raw: string | undefined, dialect: Dialect): number | undefined {
  if (!raw) return undefined
  const parts = parseVersionSegments(dialect === 'mariadb' ? extractMariaDBVersion(raw) : raw)
  if (parts.length < 3) return undefined
  return parts[0]! * 10000 + parts[1]! * 100 + parts[2]!
}

/** Only executable text is exposed to the leading-keyword recognizer. Quoted text is inert. */
function executableText(
  sql: string,
  dialect: Dialect,
  version: number,
  backslashes: boolean,
  depth = 0
): string {
  if (depth > 16) unsafeInput()
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      i++
      while (i < sql.length) {
        if (sql[i] === '\\' && backslashes && ch !== '`') {
          i += 2
          continue
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2
            continue
          }
          i++
          break
        }
        i++
      }
      out += ' ? '
    } else if (
      ch === '#' ||
      (sql.startsWith('--', i) &&
        (sql[i + 2] === undefined || sql.charCodeAt(i + 2) <= 32 || sql.charCodeAt(i + 2) === 127))
    ) {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
    } else if (sql.startsWith('/*', i)) {
      const mariaOnly = sql.startsWith('/*M!', i)
      const executable = sql.startsWith('/*!', i) || (mariaOnly && dialect === 'mariadb')
      const end = sql.indexOf('*/', i + 2)
      if (end === -1) {
        out += ' '
        break
      }
      if (executable) {
        let body = sql.slice(i + (mariaOnly ? 4 : 3), end)
        let minimum = 0
        // MySQL <8.4 consumes five version digits; 8.4 also accepts six followed by whitespace.
        const digits = body.match(
          dialect === 'mariadb'
            ? /^\d{5,6}/
            : version >= 80400
              ? /^(\d{6})(?=\s|$)|^(\d{5})/
              : /^(\d{5})/
        )?.[0]
        if (digits) {
          minimum = Number(digits)
          body = body.slice(digits.length)
        }
        const mariaIgnoresMysql =
          dialect === 'mariadb' && !mariaOnly && minimum >= 50700 && minimum <= 99999
        if (version >= minimum && !mariaIgnoresMysql)
          out += ' ' + executableText(body, dialect, version, backslashes, depth + 1) + ' '
        else out += ' '
      } else out += ' '
      i = end + 2
    } else {
      out += ch
      i++
    }
  }
  return out
}

/**
 * Version discovery already happens at connect. If it failed, evaluate correlated version
 * intervals, not independently optional comments (which invent impossible statements).
 * A disagreement is a safe refusal, before any statement executes (GATE-002).
 */
export function isGrantQuery(sql: string, serverVersion?: string): boolean {
  // mysql2 can connect to either flavor regardless of the configured system name.
  const actual = serverVersion && isMariaDBVersion(serverVersion) ? 'mariadb' : 'mysql'
  const known = versionNumber(serverVersion, actual)
  const dialects: Dialect[] = known === undefined ? ['mysql', 'mariadb'] : [actual]
  const versions = new Set<number>(known === undefined ? [0, 80400] : [known])
  if (known === undefined) {
    for (const match of sql.matchAll(/\/\*(?:M)?!(\d{5,6})/g)) {
      versions.add(Number(match[1]))
      versions.add(Number(match[1]!.slice(0, 5)))
    }
  }
  let result: boolean | undefined
  for (const flavor of dialects) {
    for (const version of versions) {
      for (const backslashes of [false, true]) {
        const text = executableText(sql, flavor, version, backslashes)
        const isGrant = /^\s*SHOW\s+GRANTS\b/i.test(text)
        if (result !== undefined && result !== isGrant) unsafeInput()
        result = isGrant
      }
    }
  }
  return result ?? false
}

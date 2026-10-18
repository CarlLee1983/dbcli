/** SHOW GRANTS output is inspection text, never a credential export or replay script. */
export const OMITTED_GRANT = '[OMITTED: grant text could not be safely redacted]'

type Token = {
  kind: 'word' | 'quoted' | 'symbol' | 'number'
  text: string
  start: number
  end: number
}

// Parse both backslash modes below: disagreeing token boundaries are not safe to expose.
function tokens(source: string, backslashes: boolean): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < source.length) {
    if (/\s/.test(source[i]!)) {
      i++
      continue
    }
    const start = i
    const ch = source[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      i++
      let closed = false
      while (i < source.length) {
        if (source[i] === '\\' && backslashes && ch !== '`') {
          i += 2
          continue
        }
        if (source[i] === ch) {
          if (source[i + 1] === ch) {
            i += 2
            continue
          }
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) return null
      out.push({ kind: 'quoted', text: source.slice(start, i), start, end: i })
    } else {
      const word = source.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_$]*/)?.[0]
      const number = source.slice(i).match(/^\d+(?:\.\d+)?/)?.[0]
      if (word || number) {
        const text = word ?? number!
        i += text.length
        out.push({ kind: word ? 'word' : 'number', text: text.toUpperCase(), start, end: i })
      } else if ('@.,()*;'.includes(ch)) {
        i++
        out.push({ kind: 'symbol', text: ch, start, end: i })
      } else return null
    }
  }
  return out
}

const PRIVILEGES = new Set([
  'ALL',
  'ALL PRIVILEGES',
  'ALTER',
  'ALTER ROUTINE',
  'BINLOG ADMIN',
  'BINLOG MONITOR',
  'BINLOG REPLAY',
  'CONNECTION ADMIN',
  'CREATE',
  'CREATE ROUTINE',
  'CREATE TABLESPACE',
  'CREATE TEMPORARY TABLES',
  'CREATE USER',
  'CREATE VIEW',
  'DELETE',
  'DELETE HISTORY',
  'DROP',
  'EVENT',
  'EXECUTE',
  'FEDERATED ADMIN',
  'FILE',
  'GRANT OPTION',
  'INDEX',
  'INSERT',
  'LOCK TABLES',
  'PROCESS',
  'READ ONLY ADMIN',
  'RELOAD',
  'REPLICATION CLIENT',
  'REPLICATION MASTER ADMIN',
  'REPLICATION SLAVE',
  'REPLICATION SLAVE ADMIN',
  'REFERENCES',
  'SELECT',
  'SET USER',
  'SHOW CREATE ROUTINE',
  'SHOW DATABASES',
  'SHOW VIEW',
  'SHUTDOWN',
  'SLAVE MONITOR',
  'SUPER',
  'TRIGGER',
  'UPDATE',
  'USAGE',
])
const RESOURCE_OPTIONS = new Set([
  'MAX_QUERIES_PER_HOUR',
  'MAX_UPDATES_PER_HOUR',
  'MAX_CONNECTIONS_PER_HOUR',
  'MAX_USER_CONNECTIONS',
  'MAX_STATEMENT_TIME',
])

/** A bounded grammar validator: unknown grammar never falls back to the original cell. */
export function redactGrant(value: unknown): string {
  if (typeof value !== 'string') return OMITTED_GRANT
  const ts = tokens(value, true)
  const alternative = tokens(value, false)
  if (!ts || !alternative || JSON.stringify(ts) !== JSON.stringify(alternative))
    return OMITTED_GRANT
  let at = 0
  const replacements: { start: number; end: number }[] = []
  const current = () => ts[at]
  const word = (text: string) => current()?.kind === 'word' && current()?.text === text
  const take = (text: string): boolean => {
    if (current()?.text !== text || (/[A-Z]/.test(text) && current()?.kind !== 'word')) return false
    at++
    return true
  }
  const need = (text: string) => {
    if (!take(text)) throw new Error('unsupported grant format')
  }
  const name = () => {
    if (current()?.kind !== 'quoted' && current()?.kind !== 'word') throw new Error('missing name')
    at++
  }
  const account = () => {
    const contextual = word('CURRENT_USER') || word('CURRENT_ROLE')
    name()
    if (contextual && take('(')) need(')')
    if (take('@')) name()
  }
  const payload = () => {
    const wrapped = take('PASSWORD')
    if (wrapped) need('(')
    const t = current()
    if (t?.kind !== 'quoted' || t.text[0] === '`') throw new Error('unsupported auth payload')
    replacements.push({ start: t.start, end: t.end })
    at++
    if (wrapped) need(')')
  }
  const authentication = () => {
    if (!take('IDENTIFIED')) return
    if (take('BY')) {
      take('PASSWORD')
      payload()
      return
    }
    if (!take('VIA') && !take('WITH')) throw new Error('unknown authentication')
    do {
      name()
      if (take('USING') || take('AS')) payload()
    } while (take('OR'))
  }
  const grantees = () => {
    do {
      account()
      authentication()
    } while (take(','))
  }
  const suffix = () => {
    if (take('REQUIRE')) {
      if (!take('NONE') && !take('SSL') && !take('X509')) {
        let count = 0
        do {
          if (!take('CIPHER') && !take('ISSUER') && !take('SUBJECT'))
            throw new Error('unknown TLS option')
          if (current()?.kind !== 'quoted' || current()?.text[0] === '`')
            throw new Error('missing TLS value')
          at++
          count++
          if (take('AND')) continue
          if (!word('CIPHER') && !word('ISSUER') && !word('SUBJECT')) break
        } while (at < ts.length)
        if (!count) throw new Error('missing TLS option')
      }
    }
    if (take('WITH')) {
      let count = 0
      while (at < ts.length && current()?.text !== ';') {
        if (take('GRANT') || take('ADMIN')) need('OPTION')
        else if (current()?.kind === 'word' && RESOURCE_OPTIONS.has(current()!.text)) {
          at++
          if (current()?.kind !== 'number') throw new Error('missing resource limit')
          at++
        } else throw new Error('unknown grant option')
        count++
      }
      if (!count) throw new Error('missing grant option')
    }
    take(';')
    if (at !== ts.length) throw new Error('unrecognized trailing content')
  }
  try {
    if (take('SET')) {
      need('DEFAULT')
      need('ROLE')
      do {
        account()
      } while (take(','))
      if (!take('FOR') && !take('TO')) throw new Error('missing default role target')
      do {
        account()
      } while (take(','))
    } else {
      need('GRANT')
      if (take('PROXY')) {
        need('ON')
        account()
      } else {
        // ON separates privileges from role grants; quoted keyword names never count.
        const on = ts.findIndex((t, index) => index >= at && t.kind === 'word' && t.text === 'ON')
        const to = ts.findIndex((t, index) => index >= at && t.kind === 'word' && t.text === 'TO')
        if (on >= 0 && (to < 0 || on < to)) {
          do {
            const words: string[] = []
            while (current()?.kind === 'word' && !word('ON')) words.push(ts[at++]!.text)
            const privilege = words.join(' ')
            // MySQL's extensible dynamic privileges are single identifiers with underscores.
            if (!PRIVILEGES.has(privilege) && !/^[A-Z]+(?:_[A-Z0-9]+)+$/.test(privilege))
              throw new Error('unknown privilege')
            if (take('(')) {
              do {
                name()
              } while (take(','))
              need(')')
            }
          } while (take(','))
          need('ON')
          if (take('PACKAGE')) take('BODY')
          else if (!take('TABLE') && !take('FUNCTION')) take('PROCEDURE')
          if (!take('*')) name()
          if (take('.') && !take('*')) name()
        } else {
          do {
            account()
          } while (take(','))
        }
      }
      need('TO')
      grantees()
    }
    suffix()
    let result = value
    for (const r of replacements.reverse())
      result = result.slice(0, r.start) + "'[REDACTED]'" + result.slice(r.end)
    return result
  } catch {
    // Parser diagnostics must never echo the cell, even on failure.
    return OMITTED_GRANT
  }
}

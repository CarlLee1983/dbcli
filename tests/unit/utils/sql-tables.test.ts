/**
 * extractTableReferences — enumerate every table a statement reads or writes.
 *
 * The blacklist decides on this list, so a missed reference is a disclosure,
 * not a cosmetic defect. Over-reporting (a CTE alias, a derived-table alias)
 * only ever blocks more, so these tests pin the misses, not the extras.
 */

import { describe, it, expect } from 'bun:test'
import { extractTableReferences } from '../../../src/utils/sql-tables'

describe('extractTableReferences', () => {
  describe('single table', () => {
    it('reads the table of a plain SELECT', () => {
      expect(extractTableReferences('SELECT * FROM users')).toEqual(['users'])
    })

    it('reads INSERT / UPDATE / DELETE targets', () => {
      expect(extractTableReferences('INSERT INTO log (a) VALUES (1)')).toContain('log')
      expect(extractTableReferences('UPDATE settings SET a = 1')).toContain('settings')
      expect(extractTableReferences('DELETE FROM session WHERE id = 1')).toContain('session')
    })

    it('returns nothing when there is no table reference', () => {
      expect(extractTableReferences('SELECT 1')).toEqual([])
    })
  })

  describe('the references issue #23 reported as invisible', () => {
    it('sees the JOIN side', () => {
      const refs = extractTableReferences(
        'SELECT o.id, u.password_hash FROM orders o JOIN users u ON u.id = o.user_id'
      )
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('sees a comma-separated FROM list', () => {
      const refs = extractTableReferences('SELECT * FROM orders, users')
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('sees comma-separated tables that carry aliases', () => {
      const refs = extractTableReferences('SELECT * FROM orders o, users u, audit_log a')
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
      expect(refs).toContain('audit_log')
    })

    it('sees every branch of a UNION', () => {
      const refs = extractTableReferences(
        'SELECT id FROM orders UNION ALL SELECT password_hash FROM users'
      )
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('sees a table reached only through a subquery', () => {
      expect(extractTableReferences('SELECT * FROM (SELECT * FROM users) t')).toContain('users')
    })

    it('sees a table reached only through a CTE body', () => {
      const refs = extractTableReferences(
        'WITH secret AS (SELECT * FROM users) SELECT * FROM secret'
      )
      expect(refs).toContain('users')
    })

    it('sees a table reached only through an IN (SELECT ...) predicate', () => {
      const refs = extractTableReferences(
        'SELECT * FROM orders WHERE user_id IN (SELECT id FROM users)'
      )
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('sees every JOIN flavour', () => {
      const sql = `SELECT * FROM a
        LEFT OUTER JOIN b ON b.id = a.id
        INNER JOIN c ON c.id = a.id
        CROSS JOIN d
        FULL JOIN e ON e.id = a.id`
      const refs = extractTableReferences(sql)
      for (const table of ['a', 'b', 'c', 'd', 'e']) {
        expect(refs).toContain(table)
      }
    })
  })

  describe('qualified and quoted names', () => {
    it('reports both the bare and the schema-qualified form', () => {
      const refs = extractTableReferences('SELECT * FROM public.users')
      expect(refs).toContain('users')
      expect(refs).toContain('public.users')
    })

    it('unwraps quoted identifiers', () => {
      expect(extractTableReferences('SELECT * FROM "users"')).toContain('users')
      expect(extractTableReferences('SELECT * FROM `users`')).toContain('users')
      expect(extractTableReferences('SELECT * FROM "public"."users"')).toContain('users')
    })

    it('keeps a quoted identifier that looks like a keyword', () => {
      expect(extractTableReferences('SELECT * FROM "select"')).toContain('select')
    })
  })

  describe('text that must not become a table reference', () => {
    it('ignores a string literal that spells a FROM clause', () => {
      expect(extractTableReferences("SELECT 'FROM users' AS note")).not.toContain('users')
    })

    it('ignores a commented-out FROM clause', () => {
      expect(extractTableReferences('SELECT 1 -- FROM users\n')).not.toContain('users')
      expect(extractTableReferences('SELECT 1 /* FROM users */')).not.toContain('users')
    })

    it('does not let a set-returning function hide the rest of the list', () => {
      // `generate_series` itself is reported — an identifier is reported
      // whether or not it can be a table. What must not happen is losing
      // `secrets`, which is what stopping at the function call used to do.
      expect(extractTableReferences('SELECT * FROM generate_series(1, 10) g, secrets')).toContain(
        'secrets'
      )
    })
  })

  describe('positions other than FROM / JOIN / INTO / UPDATE', () => {
    it('sees the table list of a PostgreSQL multi-table DELETE', () => {
      const refs = extractTableReferences('DELETE FROM orders USING users WHERE 1 = 1', {
        dialect: 'postgresql',
      })
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('sees the source of a MERGE', () => {
      const refs = extractTableReferences('MERGE INTO orders USING users s ON 1 = 1', {
        dialect: 'postgresql',
      })
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('keeps walking the table list past a JOIN ... USING column list', () => {
      const refs = extractTableReferences('SELECT * FROM orders JOIN t2 USING (id), users', {
        dialect: 'postgresql',
      })
      expect(refs).toContain('orders')
      expect(refs).toContain('t2')
      expect(refs).toContain('users')
    })

    it('keeps walking past index hints, partition selectors and alias lists', () => {
      const decorated = [
        ['SELECT * FROM orders AS o (a, b), users', 'postgresql'],
        ['SELECT * FROM orders USE INDEX (i), users', 'mysql'],
        ['SELECT * FROM orders PARTITION (p0), users', 'mysql'],
        ['SELECT * FROM orders o TABLESAMPLE bernoulli(1), users', 'postgresql'],
      ] as const
      for (const [sql, dialect] of decorated) {
        expect(extractTableReferences(sql, { dialect })).toContain('users')
      }
    })

    it('sees TRUNCATE with and without the optional TABLE keyword', () => {
      expect(extractTableReferences('TRUNCATE users')).toContain('users')
      expect(extractTableReferences('TRUNCATE TABLE users')).toContain('users')
      expect(extractTableReferences('TRUNCATE TABLE users')).not.toContain('table')
    })

    it('sees a PostgreSQL COPY source', () => {
      expect(
        extractTableReferences('COPY users TO STDOUT', { dialect: 'postgresql' })
      ).toContain('users')
    })

    it('sees a parenthesised join', () => {
      const refs = extractTableReferences('SELECT * FROM (orders JOIN users ON users.id = 1)', {
        dialect: 'postgresql',
      })
      expect(refs).toContain('orders')
      expect(refs).toContain('users')
    })

    it('does not read a derived-table subquery keyword as a table', () => {
      expect(extractTableReferences('SELECT * FROM (SELECT * FROM users) t')).not.toContain(
        'select'
      )
    })
  })

  describe('dialect-specific lexing', () => {
    it('sees through a MySQL executable comment', () => {
      expect(
        extractTableReferences('SELECT * FROM /*!50000 users */', { dialect: 'mysql' })
      ).toContain('users')
      expect(
        extractTableReferences('SELECT * FROM orders /*!50000 , users */', { dialect: 'mysql' })
      ).toContain('users')
      expect(
        extractTableReferences('SELECT * FROM orders /*M!50000 , users */', { dialect: 'mariadb' })
      ).toContain('users')
    })

    it('still skips an ordinary block comment', () => {
      expect(
        extractTableReferences('SELECT 1 /* FROM users */', { dialect: 'mysql' })
      ).toEqual([])
    })

    it('skips a MySQL # comment only in MySQL', () => {
      expect(extractTableReferences('SELECT 1 # FROM users\n', { dialect: 'mysql' })).toEqual([])
      // In PostgreSQL `#` is an operator, so the text after it still runs.
      expect(
        extractTableReferences('SELECT 1 # FROM users\n', { dialect: 'postgresql' })
      ).toContain('users')
    })

    it('skips a PostgreSQL dollar-quoted string', () => {
      expect(
        extractTableReferences('SELECT $q$ FROM users $q$ AS note', { dialect: 'postgresql' })
      ).not.toContain('users')
    })

    it('does not let a backslash inside a literal swallow the rest of the statement', () => {
      // Whether `\` escapes a quote is server- and mode-dependent. Assuming it
      // does would let `'a\'` hide everything up to the next quote — including
      // a FROM clause the server still executes. Ending the literal at the
      // quote can only over-report, so it is the answer in every dialect.
      const sql = "SELECT 'a\\' , x FROM secrets"
      expect(extractTableReferences(sql)).toContain('secrets')
      expect(extractTableReferences(sql, { dialect: 'postgresql' })).toContain('secrets')
      expect(extractTableReferences(sql, { dialect: 'mysql' })).toContain('secrets')
    })
  })

  describe('deduplication', () => {
    it('reports a repeated table once', () => {
      const refs = extractTableReferences(
        'SELECT * FROM users u1 JOIN users u2 ON u1.id = u2.parent_id'
      )
      expect(refs.filter((r) => r === 'users')).toHaveLength(1)
    })

    it('is case-insensitive when deduplicating', () => {
      const refs = extractTableReferences('SELECT * FROM Users JOIN users ON 1 = 1')
      expect(refs.filter((r) => r.toLowerCase() === 'users')).toHaveLength(1)
    })
  })
  /**
   * Round 3 of the adversarial review. Each of these returned the blacklisted
   * table's rows in full against an earlier version of this module.
   */
  describe('lexical desynchronisation must not hide the statement', () => {
    it('sees past a literal whose backslash-quote reading is ambiguous', () => {
      // Ending the literal at the quote does not merely reveal more text — it
      // flips quote parity, so the next literal runs to end of input and takes
      // the FROM clause with it. Both readings are scanned and unioned.
      const cases: [string, 'postgresql' | 'mysql'][] = [
        ["SELECT E'\\'' AS x, * FROM secrets", 'postgresql'],
        ["SELECT '\\'' AS x, * FROM secrets", 'mysql'],
        ["SELECT id, '\\'' AS x, * FROM secrets", 'mysql'],
        ['SELECT "a\\"" , 1 FROM secrets', 'mysql'],
      ]
      for (const [sql, dialect] of cases) {
        expect(extractTableReferences(sql, { dialect })).toContain('secrets')
      }
    })

    it('decodes a PostgreSQL unicode-escaped identifier', () => {
      // U&"\0073ecrets" names `secrets`; reporting the raw text alone reports a
      // name the server never resolves.
      expect(
        extractTableReferences('SELECT * FROM U&"\\0073ecrets"', { dialect: 'postgresql' })
      ).toContain('secrets')
      expect(
        extractTableReferences('SELECT * FROM U&"!0073ecrets" UESCAPE \'!\'', {
          dialect: 'postgresql',
        })
      ).toContain('secrets')
    })

    it('decodes under any legal UESCAPE character, not only punctuation', () => {
      // PostgreSQL allows any character that is not a hex digit, `+`, a quote,
      // or whitespace — including plain letters, which leaves the identifier
      // entirely alphanumeric and so invisible to a punctuation-only search.
      for (const escape of ['x', '_', 'g', '!', '#']) {
        expect(
          extractTableReferences(`SELECT * FROM U&"${escape}0073ecrets" UESCAPE '${escape}'`, {
            dialect: 'postgresql',
          })
        ).toContain('secrets')
      }
    })

    it('does not throw on an escape above the Unicode maximum', () => {
      // `\+FFFFFF` is 16777215 — out of range for String.fromCodePoint, and it
      // occurs in ordinary Windows paths inside MySQL strings.
      expect(() =>
        extractTableReferences('SELECT "a\\+FFFFFFb" FROM users', { dialect: 'postgresql' })
      ).not.toThrow()
      expect(
        extractTableReferences('SELECT * FROM logs WHERE msg = "c:\\+FFFFFF\\path"', {
          dialect: 'mysql',
        })
      ).toContain('logs')
    })

    it('uses every dialect reading when none is given', () => {
      // `--x` is a comment in PostgreSQL and executable in MySQL; `/*! … */` is
      // executable in MySQL and a comment elsewhere. With no dialect declared,
      // the reading that leaves the text visible has to win.
      expect(extractTableReferences('SELECT 1--1 UNION SELECT * FROM secrets')).toContain('secrets')
      expect(extractTableReferences('SELECT 1 /*! UNION SELECT * FROM secrets */')).toContain(
        'secrets'
      )
    })
  })

  describe('the keyword filter is the only fail-open direction', () => {
    it('reports words that are reserved in one dialect but a legal table name in another', () => {
      // `filter`, `partition`, `set`, `current` and `update` are all legal
      // unquoted table names somewhere, so none may be filtered out.
      for (const name of ['filter', 'partition', 'set', 'current', 'update', 'nulls', 'over']) {
        expect(extractTableReferences(`SELECT * FROM pub STRAIGHT_JOIN ${name} ON 1 = 1`, {
          dialect: 'mysql',
        })).toContain(name)
      }
    })

    it('sees the left operand of an ODBC outer-join escape', () => {
      expect(
        extractTableReferences('SELECT * FROM {oj secrets LEFT JOIN pub ON 1 = 1}', {
          dialect: 'mysql',
        })
      ).toContain('secrets')
    })
  })

  describe('cost', () => {
    it('stays linear on a long dotted chain', () => {
      // Reading the qualified name at every index made this quadratic: 16 KB of
      // `a.a.a…` took over 300 ms.
      const sql = `SELECT * FROM ${Array(8000).fill('a').join('.')}`
      const start = performance.now()
      extractTableReferences(sql, { dialect: 'postgresql' })
      expect(performance.now() - start).toBeLessThan(500)
    })
  })
})

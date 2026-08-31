import { describe, test, expect } from 'bun:test'
import {
  redactArgv,
  redactArgvSensitiveText,
  redactSql,
  redactParams,
  redactSensitive,
} from '../../../src/utils/redaction'

describe('redaction utils', () => {
  describe('redactArgv', () => {
    test('redacts sensitive flags', () => {
      const argv = ['node', 'query', 'SELECT 1', '--password', 'secret', '--token=abc']
      expect(redactArgv(argv)).toBe('node query <sql> --password <redacted> --token <redacted>')
    })

    test('redacts SQL in subcommands', () => {
      const argv = ['node', 'query', 'SELECT * FROM users', '--format', 'json']
      expect(redactArgv(argv)).toBe('node query <sql> --format json')
    })

    test('redacts assertion SQL, expectation text, subjects, and receipt paths', () => {
      expect(
        redactArgv([
          'dbcli',
          'assert',
          "SELECT * FROM accounts WHERE token = 'private'",
          '--expect',
          'value == private-value',
          '--verification-subject',
          'table:private-accounts',
          '--evidence-receipt',
          '/private/receipt.json',
          '--no-fail',
        ])
      ).toBe(
        'dbcli assert <sql> --expect <redacted> --verification-subject <redacted> --evidence-receipt <redacted> --no-fail'
      )
    })

    test('redacts every built-in verify scenario input while retaining its scenario name', () => {
      const cases = [
        ['safe-backfill', '--query', "UPDATE private_orders SET status = 'secret'"],
        ['migration', '--ddl', "ALTER TABLE private_orders ADD COLUMN token text DEFAULT 'secret'"],
        ['rollback', '--statement', "UPDATE private_orders SET status = 'secret'"],
        [
          'constraint',
          '--violation-query',
          "SELECT count(*) FROM private_orders WHERE token = 'secret'",
        ],
      ] as const
      for (const [scenario, valueFlag, value] of cases) {
        const redacted = redactArgv([
          'dbcli',
          'verify',
          scenario,
          '--table',
          'private_orders',
          valueFlag,
          value,
          '--verify-query',
          'SELECT count(*) FROM private_orders',
          '--expect',
          'value == 0',
          '--subject-name',
          'customer-secret',
          '--summary',
          'private summary',
          '--after-write',
          '--evidence-receipt',
          '/private/receipt.json',
        ])
        expect(redacted).toContain(`dbcli verify ${scenario}`)
        for (const secret of [
          'private_orders',
          'secret',
          'customer-secret',
          'private summary',
          '/private/receipt.json',
        ]) {
          expect(redacted).not.toContain(secret)
        }
      }
    })

    test('redacts long and short query-file paths', () => {
      expect(redactArgv(['dbcli', 'query', '--query-file', '/secret/customer.sql'])).toBe(
        'dbcli query --query-file <redacted>'
      )
      expect(redactArgv(['dbcli', 'query', '-f', '/secret/customer.sql'])).toBe(
        'dbcli query -f <redacted>'
      )
      expect(
        redactArgv(['dbcli', 'query', '-f', '/secret/customer.sql', '--no-limit', '--recovery'])
      ).toBe('dbcli query -f <redacted> --no-limit --recovery')
      expect(redactArgv(['dbcli', 'query', '-f/secret/customer.sql'])).toBe(
        'dbcli query -f <redacted>'
      )
    })

    test('redacts --config and --use', () => {
      const argv = ['node', 'list', '--config', './my.env', '--use=prod']
      expect(redactArgv(argv)).toBe('node list --config <redacted> --use <redacted>')
    })

    test('structurally redacts every lint SQL input with global options before the command', () => {
      expect(
        redactArgv([
          'bun',
          '/workspace/src/cli.ts',
          '--config',
          '/secret/config',
          '--use=secret-connection',
          'lint',
          "SELECT 'first-secret'",
          "SELECT 'second-secret'",
          '--format',
          'json',
          '--bulk',
          '@/secret/bulk.sql',
          '--no-schema',
        ])
      ).toBe(
        'bun /workspace/src/cli.ts --config <redacted> --use <redacted> lint <sql> <sql> --format json --bulk <redacted> --no-schema'
      )
    })

    test('redacts inline lint bulk values while preserving non-sensitive flags', () => {
      expect(
        redactArgv([
          'dbcli',
          'lint',
          '--bulk=@queries/secret.sql',
          '--min-severity',
          'warn',
          '--recovery',
        ])
      ).toBe('dbcli lint --bulk <redacted> --min-severity warn --recovery')
    })

    test('redacts leading-comment lint SQL after the end-of-options delimiter', () => {
      const sql = "-- SQL_SECRET_COMMENT\nSELECT 'SQL_SECRET_VALUE'"
      expect(redactArgv(['dbcli', 'lint', '--format', 'json', '--no-schema', '--', sql])).toBe(
        'dbcli lint --format json --no-schema -- <sql>'
      )
    })

    test('treats only known pre-delimiter options as options for lint redaction', () => {
      expect(redactArgv(['dbcli', 'lint', '--unknown-sql-prefix', '--format', 'json'])).toBe(
        'dbcli lint <sql> --format json'
      )
    })

    test('keeps safe flags', () => {
      const argv = ['node', 'list', '--format=table', '--conn-name', 'my-db']
      expect(redactArgv(argv)).toBe('node list --format=table --conn-name my-db')
    })

    test('keeps field projection syntax without mistaking it for SQL', () => {
      expect(
        redactArgv(['dbcli', 'query', '-f', '/secret/query.sql', '--fields=-raw,-payload'])
      ).toBe('dbcli query -f <redacted> --fields=-raw,-payload')
      expect(redactArgv(['dbcli', 'query', 'SELECT 1', '--fields', 'id,name'])).toBe(
        'dbcli query <sql> --fields id,name'
      )
    })

    test('keeps table truncation options without mistaking values for SQL', () => {
      expect(redactArgv(['dbcli', 'query', 'SELECT 1', '--truncate', '80'])).toBe(
        'dbcli query <sql> --truncate 80'
      )
      expect(redactArgv(['dbcli', 'query', 'SELECT 1', '--no-truncate'])).toBe(
        'dbcli query <sql> --no-truncate'
      )
    })
  })

  describe('redactArgvSensitiveText', () => {
    test('scrubs query-file paths from diagnostics', () => {
      const path = '/secret/customer.sql'
      expect(
        redactArgvSensitiveText(`Failed to read query file ${path}`, ['dbcli', 'query', '-f', path])
      ).toBe('Failed to read query file <redacted>')

      expect(
        redactArgvSensitiveText(`Failed to read query file ${path}`, [
          'dbcli',
          'query',
          `-f${path}`,
        ])
      ).toBe('Failed to read query file <redacted>')
    })

    test('scrubs leading-comment lint SQL after the end-of-options delimiter', () => {
      const sql = "-- SQL_SECRET_COMMENT\nSELECT 'SQL_SECRET_VALUE'"
      const redacted = redactArgvSensitiveText(`failed to parse: ${sql}`, [
        'dbcli',
        'lint',
        '--no-schema',
        '--',
        sql,
      ])

      expect(redacted).toBe('failed to parse: <redacted>')
      expect(redacted).not.toContain('SQL_SECRET_COMMENT')
      expect(redacted).not.toContain('SQL_SECRET_VALUE')
    })
  })

  describe('redactSql', () => {
    test('redacts string literals', () => {
      const sql = 'SELECT * FROM users WHERE email = \'test@example.com\' AND name = "John"'
      expect(redactSql(sql)).toBe("SELECT * FROM users WHERE email = '?' AND name = '?'")
    })

    test('redacts numeric literals', () => {
      const sql = 'SELECT * FROM orders WHERE id = 123 AND amount > 45.67'
      expect(redactSql(sql)).toBe('SELECT * FROM orders WHERE id = 0 AND amount > 0')
    })

    test('preserves keywords', () => {
      const sql = 'SELECT name, age FROM users ORDER BY age DESC LIMIT 10'
      expect(redactSql(sql)).toBe('SELECT name, age FROM users ORDER BY age DESC LIMIT 0')
    })

    test('redacts PostgreSQL dollar-quoted strings (untagged and tagged)', () => {
      expect(redactSql('SELECT * FROM t WHERE token = $$secret$$')).not.toContain('secret')
      expect(redactSql('SELECT * FROM t WHERE token = $tag$secret$tag$')).not.toContain('secret')
    })
  })

  describe('redactParams', () => {
    test('redacts simple objects', () => {
      const params = { key: 'secret', id: 123 }
      expect(redactParams(params)).toEqual({ key: '<redacted>', id: '<redacted>' })
    })

    test('redacts nested objects', () => {
      const params = { user: { password: 'pw' }, tags: ['a', 'b'] }
      expect(redactParams(params)).toEqual({
        user: { password: '<redacted>' },
        tags: ['<redacted>', '<redacted>'],
      })
    })

    test('handles null and undefined', () => {
      expect(redactParams(null)).toBeNull()
      expect(redactParams(undefined)).toBeUndefined()
    })
  })
})

/**
 * 第五輪：ES 連線失敗的錯誤訊息帶著整串 baseUrl，而 `nodes` 設定常寫成
 * `https://elastic:hunter2@host:9243`。那個訊息會進 audit 的 error 欄，
 * `redactSensitive` 只認 `keyword[:=]value`，URL 的 userinfo 一個都不吃，
 * 於是明文帳密落進 `.dbcli/audit/<conn>.jsonl`。session 中途 ES 重啟即可觸發。
 */
describe('redactSensitive 與 URL 裡的帳密', () => {
  test('連線字串的 userinfo 被遮蔽', () => {
    expect(
      redactSensitive('Connection refused at https://elastic:hunter2@es.example.com:9243')
    ).toBe('Connection refused at https://<redacted>@es.example.com:9243')
  })

  test('只有使用者名稱、沒有密碼的 userinfo 也遮掉', () => {
    expect(redactSensitive('Host not found: http://elastic@localhost:9200')).toBe(
      'Host not found: http://<redacted>@localhost:9200'
    )
  })

  test('沒有 userinfo 的 URL 原樣保留——遮蔽不得吃掉可診斷的資訊', () => {
    expect(redactSensitive('Connection refused at http://localhost:9200')).toBe(
      'Connection refused at http://localhost:9200'
    )
  })

  test('不會誤傷 email 之類非 URL 的 @', () => {
    expect(redactSensitive('contact ops@example.com')).toBe('contact ops@example.com')
  })
})

/**
 * 第六輪：userinfo 的比對 `[^/@\s]+@` 停在第一個 `@`，所以密碼裡含字面 `@`
 * 時尾巴會留在紀錄裡。真實 URL 的 `@` 應該編碼成 `%40`，但錯誤訊息帶的是
 * 使用者寫在設定檔裡的那一串，不是規範化過的。
 */
test('userinfo 裡含字面 @ 的密碼整段被遮蔽', () => {
  expect(
    redactSensitive('Connection refused at https://elastic:p@ssw0rd@es.example.com:9243')
  ).toBe('Connection refused at https://<redacted>@es.example.com:9243')
})

test('遮蔽在 host 之後就停手，不吃掉路徑裡的 @', () => {
  expect(redactSensitive('GET https://es.example.com/idx/_doc/a@b')).toBe(
    'GET https://es.example.com/idx/_doc/a@b'
  )
})

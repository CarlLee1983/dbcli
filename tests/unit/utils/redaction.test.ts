import { describe, test, expect } from 'bun:test'
import {
  redactArgv,
  redactArgvSensitiveText,
  redactSql,
  redactParams,
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
        redactArgvSensitiveText(`Failed to read query file ${path}`, [
          'dbcli',
          'query',
          '-f',
          path,
        ])
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

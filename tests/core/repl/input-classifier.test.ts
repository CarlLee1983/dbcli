// tests/core/repl/input-classifier.test.ts
import { describe, test, expect } from 'bun:test'
import { classifyInput } from '../../../src/core/repl/input-classifier'

describe('classifyInput', () => {
  describe('empty input', () => {
    test('returns empty for blank string', () => {
      const result = classifyInput('')
      expect(result.type).toBe('empty')
    })

    test('returns empty for whitespace-only', () => {
      const result = classifyInput('   \t  ')
      expect(result.type).toBe('empty')
    })
  })

  describe('meta commands', () => {
    test('classifies .help as meta', () => {
      const result = classifyInput('.help')
      expect(result.type).toBe('meta')
      expect(result.normalized).toBe('.help')
    })

    test('classifies .quit as meta', () => {
      const result = classifyInput('.quit')
      expect(result.type).toBe('meta')
    })

    test('classifies .exit as meta', () => {
      const result = classifyInput('.exit')
      expect(result.type).toBe('meta')
    })

    test('classifies .clear as meta', () => {
      const result = classifyInput('.clear')
      expect(result.type).toBe('meta')
    })

    test('classifies .format json as meta', () => {
      const result = classifyInput('.format json')
      expect(result.type).toBe('meta')
      expect(result.normalized).toBe('.format json')
    })

    test('classifies .timing on as meta', () => {
      const result = classifyInput('.timing on')
      expect(result.type).toBe('meta')
    })

    test('classifies .history as meta', () => {
      const result = classifyInput('.history')
      expect(result.type).toBe('meta')
    })
  })

  describe('SQL statements', () => {
    test('classifies SELECT as sql', () => {
      const result = classifyInput('SELECT * FROM users;')
      expect(result.type).toBe('sql')
    })

    test('classifies lowercase select as sql', () => {
      const result = classifyInput('select * from users;')
      expect(result.type).toBe('sql')
    })

    test('classifies INSERT as sql', () => {
      const result = classifyInput("INSERT INTO users (name) VALUES ('alice');")
      expect(result.type).toBe('sql')
    })

    test('classifies CREATE TABLE as sql', () => {
      const result = classifyInput('CREATE TABLE posts (id SERIAL PRIMARY KEY);')
      expect(result.type).toBe('sql')
    })

    test('classifies WITH (CTE) as sql', () => {
      const result = classifyInput('WITH cte AS (SELECT 1) SELECT * FROM cte;')
      expect(result.type).toBe('sql')
    })

    test('classifies ALTER TABLE as sql', () => {
      const result = classifyInput('ALTER TABLE users ADD COLUMN age INTEGER;')
      expect(result.type).toBe('sql')
    })

    test('classifies DROP TABLE as sql', () => {
      const result = classifyInput('DROP TABLE temp_data;')
      expect(result.type).toBe('sql')
    })

    test('classifies EXPLAIN as sql', () => {
      const result = classifyInput('EXPLAIN SELECT * FROM users;')
      expect(result.type).toBe('sql')
    })

    test('classifies input ending with ; as sql even without keyword', () => {
      const result = classifyInput('something weird;')
      expect(result.type).toBe('sql')
    })
  })

  describe('dbcli commands', () => {
    test('classifies schema as command', () => {
      const result = classifyInput('schema users')
      expect(result.type).toBe('command')
      expect(result.normalized).toBe('schema users')
    })

    test('classifies list as command', () => {
      const result = classifyInput('list')
      expect(result.type).toBe('command')
    })

    test('classifies blacklist list as command', () => {
      const result = classifyInput('blacklist list')
      expect(result.type).toBe('command')
    })

    test('classifies status as command', () => {
      const result = classifyInput('status')
      expect(result.type).toBe('command')
    })

    test('classifies export with format as command', () => {
      const result = classifyInput('export "SELECT 1" --format json')
      expect(result.type).toBe('command')
    })
  })

  describe('edge cases', () => {
    test('trims leading/trailing whitespace', () => {
      const result = classifyInput('  SELECT 1;  ')
      expect(result.type).toBe('sql')
      expect(result.raw).toBe('  SELECT 1;  ')
      expect(result.normalized).toBe('SELECT 1;')
    })

    test('unknown input defaults to command', () => {
      const result = classifyInput('foobar baz')
      expect(result.type).toBe('command')
    })
  })
})

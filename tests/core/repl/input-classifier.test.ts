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

  describe('the backslash prefix reaches a dbcli subcommand', () => {
    // SQL wins on a keyword clash — the shell is for typing SQL, and
    // `DELETE FROM users WHERE …` has to work — so the subcommands whose names
    // are SQL keywords need a way in that no statement can claim (#88).
    test('classifies \\delete as a command, not as SQL', () => {
      const result = classifyInput('\\delete users --where status=active')
      expect(result.type).toBe('command')
    })

    test('the same for the other clashing names', () => {
      // The four dbcli subcommands whose names are SQL keywords — the complete
      // set, derived rather than remembered, so a new one cannot quietly join.
      for (const name of ['insert', 'update', 'delete', 'explain']) {
        expect(classifyInput(`\\${name} users --where id=1`).type).toBe('command')
      }
    })

    test('a name that never clashed takes the prefix too', () => {
      // One rule to remember rather than a list of which names need it.
      expect(classifyInput('\\query "SELECT 1"').type).toBe('command')
    })

    test('a trailing semicolon does not turn a prefixed command back into SQL', () => {
      // The prefix is the whole point: nothing after it may reclassify the line.
      // `;` is habit for anyone typing SQL all day, and it used to send
      // `\\delete users --where x;` down the SQL path.
      expect(classifyInput('\\delete users --where x;').type).toBe('command')
    })

    test('a bare clashing name is still SQL', () => {
      // The decision, pinned: nothing about the shape of the line changes this.
      expect(classifyInput('delete users --where status=active').type).toBe('sql')
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

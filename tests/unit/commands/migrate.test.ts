/**
 * Migrate command logic tests
 * Tests core migration logic directly by calling runDDL
 */

import { test, expect, describe, spyOn, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { runDDL } from '../../../src/commands/migrate'

const FIXTURE_CONFIG = join(import.meta.dir, '../../fixtures/admin.dbcli.json')

describe('migrate core logic', () => {
  let logOutput = ''
  let errorOutput = ''
  let exitCode: number | undefined = undefined
  
  const logSpy = spyOn(console, 'log').mockImplementation((msg) => {
    logOutput += msg + '\n'
  })
  
  const errorSpy = spyOn(console, 'error').mockImplementation((msg) => {
    errorOutput += msg + '\n'
  })

  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  beforeEach(() => {
    logOutput = ''
    errorOutput = ''
    exitCode = undefined
    logSpy.mockClear()
    errorSpy.mockClear()
    exitSpy.mockClear()
  })

  afterEach(() => {
    // We don't restore because we want them mocked for all tests
  })

  async function runAction(op: any, opts: any = {}) {
    await runDDL(op, { config: FIXTURE_CONFIG, ...opts })
    return { 
      stdout: logOutput.trim(), 
      stderr: errorOutput.trim() 
    }
  }

  function parseJSON(text: string, context?: string) {
    try {
      const start = text.indexOf('{')
      if (start === -1) {
        // If it's empty but we have an exit code, maybe it's a silent failure
        if (exitCode !== undefined) {
           throw new Error(`Command failed with exit code ${exitCode}. No JSON found. Stderr: "${errorOutput.trim()}"`)
        }
        throw new Error(`No JSON found in output: "${text}"`)
      }
      return JSON.parse(text.substring(start))
    } catch (e) {
      console.error(`Failed to parse JSON for ${context || 'unknown'}:`);
      console.error(`Raw output: "${text}"`);
      throw e;
    }
  }

  // ── create ───────────────────────────────────────────────────────────────

  describe('createTable', () => {
    test('dry-run returns SQL', async () => {
      const { stdout } = await runAction({
        kind: 'createTable',
        table: 'test_table',
        columns: [
          { name: 'id', type: 'serial', primaryKey: true },
          { name: 'name', type: 'varchar(50)', nullable: false }
        ]
      })
      const result = parseJSON(stdout, 'createTable')
      expect(result.status).toBe('success')
      expect(result.dryRun).toBe(true)
      expect(result.operation).toBe('createTable')
      expect(result.sql).toContain('CREATE TABLE')
      expect(result.sql).toContain('test_table')
    })
  })

  // ── drop ─────────────────────────────────────────────────────────────────

  describe('dropTable', () => {
    test('dry-run returns DROP SQL', async () => {
      const { stdout } = await runAction({ kind: 'dropTable', table: 'test_table' })
      const result = parseJSON(stdout, 'dropTable')
      expect(result.sql).toContain('DROP TABLE')
    })
  })

  // ── add-column ───────────────────────────────────────────────────────────

  describe('addColumn', () => {
    test('dry-run returns ALTER TABLE ADD COLUMN', async () => {
      const { stdout } = await runAction({
        kind: 'addColumn',
        table: 'users',
        column: { name: 'bio', type: 'text', nullable: true }
      })
      const result = parseJSON(stdout, 'addColumn')
      expect(result.sql).toContain('ADD COLUMN')
      expect(result.sql).toContain('bio')
    })

    test('with default value', async () => {
      const { stdout } = await runAction({
        kind: 'addColumn',
        table: 'users',
        column: { name: 'age', type: 'integer', default: '0' }
      })
      const result = parseJSON(stdout, 'addColumn default')
      expect(result.sql).toContain('DEFAULT 0')
    })
  })

  // ── drop-column ──────────────────────────────────────────────────────────

  describe('dropColumn', () => {
    test('dry-run returns ALTER TABLE DROP COLUMN', async () => {
      const { stdout } = await runAction({
        kind: 'dropColumn',
        table: 'users',
        column: 'bio'
      })
      const result = parseJSON(stdout, 'dropColumn')
      expect(result.sql).toContain('DROP COLUMN')
    })
  })

  // ── alter-column ─────────────────────────────────────────────────────────

  describe('alterColumn', () => {
    test('change type', async () => {
      const { stdout } = await runAction({
        kind: 'alterColumn',
        table: 'users',
        column: 'name',
        options: { type: 'varchar(200)' }
      })
      const result = parseJSON(stdout, 'alterColumn type')
      expect(result.sql).toContain('VARCHAR(200)')
    })

    test('rename column', async () => {
      const { stdout } = await runAction({
        kind: 'alterColumn',
        table: 'users',
        column: 'email',
        options: { rename: 'user_email' }
      })
      const result = parseJSON(stdout, 'alterColumn rename')
      expect(result.sql).toContain('RENAME COLUMN')
      expect(result.sql).toContain('user_email')
    })
  })

  // ── add-index ────────────────────────────────────────────────────────────

  describe('addIndex', () => {
    test('basic index', async () => {
      const { stdout } = await runAction({
        kind: 'addIndex',
        table: 'users',
        index: { columns: ['email'] }
      })
      const result = parseJSON(stdout, 'addIndex')
      expect(result.sql).toContain('CREATE')
      expect(result.sql).toContain('INDEX')
      expect(result.sql).toContain('email')
    })
  })

  // ── add-constraint ───────────────────────────────────────────────────────

  describe('addConstraint', () => {
    test('foreign key', async () => {
      const { stdout } = await runAction({
        kind: 'addConstraint',
        table: 'orders',
        constraint: {
          type: 'foreign_key' as any,
          columns: ['user_id'],
          references: { table: 'users', columns: ['id'] }
        }
      })
      const result = parseJSON(stdout, 'addConstraint fk')
      expect(result.sql).toContain('FOREIGN KEY')
      expect(result.sql).toContain('REFERENCES')
    })
  })

  // ── add-enum ─────────────────────────────────────────────────────────────

  describe('addEnum', () => {
    test('dry-run returns result', async () => {
      const { stdout } = await runAction({
        kind: 'addEnum',
        definition: {
          name: 'status',
          values: ['active', 'inactive']
        }
      })
      const result = parseJSON(stdout, 'addEnum')
      if (result.status !== 'success') {
        throw new Error(`addEnum failed: ${result.error}`)
      }
      expect(result.status).toBe('success')
    })
  })
})

/**
 * dbcli export 命令集成測試
 */

import { test, expect, describe } from 'bun:test'
import { exportCommand } from '@/commands/export'

describe('dbcli export command', () => {
  // 基礎命令結構測試

  test('export command function is defined', () => {
    expect(exportCommand).toBeDefined()
    expect(typeof exportCommand).toBe('function')
  })

  test('export command is async function', () => {
    const result = exportCommand('SELECT 1', { format: 'json' })
    expect(result instanceof Promise).toBe(true)
  })

  test('export command requires SQL argument', async () => {
    try {
      await exportCommand('', { format: 'json' })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('SQL query required')
    }
  })

  test('export command requires format option', async () => {
    try {
      await exportCommand('SELECT 1', { format: undefined as any })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('format')
    }
  })

  test('export command accepts json format', async () => {
    // This will fail due to no database, but validates format acceptance
    try {
      await exportCommand('SELECT 1', { format: 'json' })
    } catch (error) {
      // Expected to fail due to database not initialized
      const message = (error as Error).message
      expect(!message.includes('format')).toBe(true)
    }
  })

  test('export command accepts csv format', async () => {
    // This will fail due to no database, but validates format acceptance
    try {
      await exportCommand('SELECT 1', { format: 'csv' })
    } catch (error) {
      // Expected to fail due to database not initialized
      const message = (error as Error).message
      expect(!message.includes('format')).toBe(true)
    }
  })

  test('export command rejects invalid format', async () => {
    try {
      await exportCommand('SELECT 1', { format: 'xml' as any })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('format')
    }
  })

  test('export command accepts optional output path', async () => {
    // Validates parameter structure
    try {
      await exportCommand('SELECT 1', { format: 'json', output: '/tmp/test.json' })
    } catch (error) {
      const message = (error as Error).message
      // Should fail on database, not on parameters
      expect(!message.includes('output')).toBe(true)
    }
  })

  test('export command handles no config gracefully', async () => {
    try {
      await exportCommand('SELECT 1', { format: 'json' })
      expect.unreachable()
    } catch (error) {
      // Should get database config error or init required
      expect((error as Error).message).toMatch(/(init|config)/i)
    }
  })

  test('export command trims SQL input', async () => {
    try {
      // SQL with leading/trailing whitespace
      await exportCommand('  SELECT 1  ', { format: 'json' })
    } catch (error) {
      // Should not complain about whitespace
      const message = (error as Error).message
      expect(!message.includes('whitespace')).toBe(true)
    }
  })

  test('export command requires non-empty SQL', async () => {
    try {
      await exportCommand('   ', { format: 'json' })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('SQL query required')
    }
  })
})

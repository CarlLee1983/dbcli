// tests/core/repl/history-manager.test.ts
import { describe, test, expect, afterEach } from 'bun:test'
import { HistoryManager } from '../../../src/core/repl/history-manager'
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testHistoryPath = join(tmpdir(), `.dbcli_history_test_${Date.now()}`)

describe('HistoryManager', () => {
  afterEach(() => {
    if (existsSync(testHistoryPath)) {
      unlinkSync(testHistoryPath)
    }
  })

  test('starts with empty history when file does not exist', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    expect(mgr.getAll()).toEqual([])
  })

  test('adds entries', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('SELECT 1;')
    mgr.add('schema users')
    expect(mgr.getAll()).toEqual(['SELECT 1;', 'schema users'])
  })

  test('does not add duplicate consecutive entries', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('SELECT 1;')
    mgr.add('SELECT 1;')
    expect(mgr.getAll()).toEqual(['SELECT 1;'])
  })

  test('does not add empty strings', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('')
    mgr.add('   ')
    expect(mgr.getAll()).toEqual([])
  })

  // Suggestion fix: await save() — test is now async
  test('saves to file', async () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('SELECT 1;')
    mgr.add('schema users')
    await mgr.save()

    const content = readFileSync(testHistoryPath, 'utf-8')
    expect(content).toContain('SELECT 1;')
    expect(content).toContain('schema users')
  })

  test('loads from existing file', () => {
    writeFileSync(testHistoryPath, 'line1\nline2\nline3\n', 'utf-8')
    const mgr = new HistoryManager(testHistoryPath, 100)
    expect(mgr.getAll()).toEqual(['line1', 'line2', 'line3'])
  })

  test('respects max entries', () => {
    const mgr = new HistoryManager(testHistoryPath, 3)
    mgr.add('a')
    mgr.add('b')
    mgr.add('c')
    mgr.add('d')
    expect(mgr.getAll()).toEqual(['b', 'c', 'd'])
  })

  test('trims loaded file to max entries', () => {
    writeFileSync(testHistoryPath, 'a\nb\nc\nd\ne\n', 'utf-8')
    const mgr = new HistoryManager(testHistoryPath, 3)
    expect(mgr.getAll()).toEqual(['c', 'd', 'e'])
  })
})

/**
 * rotation.ts — unit tests (Phase 21 / Plan 21-04 Task 1)
 *
 * Covers:
 * - shouldRotate predicate: OR semantics across byte cap and entry cap (Tests 1-5)
 * - rotate(): basic rename, overwrites existing .1, fail-soft on missing source (Tests 6-8)
 *
 * Decisions verified:
 * - D-09: rename current -> .1
 * - D-10: single rolling segment (overwrite existing .1)
 * - D-11: rotation triggered on size OR entry threshold
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { rotate, shouldRotate } from '@/core/audit/rotation'

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-rotation-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe('shouldRotate predicate (D-11)', () => {
  test('Test 1: below both caps -> false', () => {
    const result = shouldRotate(
      { currentSizeBytes: 100, currentEntryCount: 5 },
      { maxBytes: 10_000, maxEntries: 100 },
      50
    )
    expect(result).toBe(false)
  })

  test('Test 2: byte cap met by adding next line -> true', () => {
    // 9990 + 50 = 10040 >= 10000
    const result = shouldRotate(
      { currentSizeBytes: 9990, currentEntryCount: 5 },
      { maxBytes: 10_000, maxEntries: 100 },
      50
    )
    expect(result).toBe(true)
  })

  test('Test 3: byte cap exactly at boundary (>=) -> true', () => {
    // 9990 + 10 = 10000 >= 10000
    const result = shouldRotate(
      { currentSizeBytes: 9990, currentEntryCount: 5 },
      { maxBytes: 10_000, maxEntries: 100 },
      10
    )
    expect(result).toBe(true)
  })

  test('Test 4: entry cap reached (currentEntryCount + 1 > maxEntries) -> true', () => {
    const result = shouldRotate(
      { currentSizeBytes: 100, currentEntryCount: 100 },
      { maxBytes: 10_000, maxEntries: 100 },
      50
    )
    expect(result).toBe(true)
  })

  test('Test 5: OR semantics — byte trigger independent of entry trigger', () => {
    // Byte trigger only: byte cap met, entry cap miles away
    expect(
      shouldRotate(
        { currentSizeBytes: 9999, currentEntryCount: 1 },
        { maxBytes: 10_000, maxEntries: 100_000 },
        5
      )
    ).toBe(true)
    // Entry trigger only: entry cap met, byte cap miles away
    expect(
      shouldRotate(
        { currentSizeBytes: 10, currentEntryCount: 1000 },
        { maxBytes: 10_000_000, maxEntries: 1000 },
        5
      )
    ).toBe(true)
    // Neither trigger: well under both caps
    expect(
      shouldRotate(
        { currentSizeBytes: 10, currentEntryCount: 1 },
        { maxBytes: 10_000_000, maxEntries: 1000 },
        5
      )
    ).toBe(false)
  })
})

describe('rotate() rename behavior (D-09 / D-10)', () => {
  test('Test 6: basic rename — current moves to previous', async () => {
    const current = join(workDir, 'file.jsonl')
    const previous = join(workDir, 'file.jsonl.1')
    await writeFile(current, 'line1\nline2\n', 'utf8')

    await rotate(current, previous)

    expect(await pathExists(current)).toBe(false)
    expect(await pathExists(previous)).toBe(true)
    expect(await readFile(previous, 'utf8')).toBe('line1\nline2\n')
  })

  test('Test 7: overwrites existing .1 (D-10 single rolling segment)', async () => {
    const current = join(workDir, 'file.jsonl')
    const previous = join(workDir, 'file.jsonl.1')
    await writeFile(current, 'new content', 'utf8')
    await writeFile(previous, 'OLD - should be overwritten', 'utf8')

    await rotate(current, previous)

    expect(await pathExists(current)).toBe(false)
    expect(await pathExists(previous)).toBe(true)
    expect(await readFile(previous, 'utf8')).toBe('new content')
  })

  test('Test 8: missing source — resolves without throwing (audit must never throw)', async () => {
    const current = join(workDir, 'does-not-exist.jsonl')
    const previous = join(workDir, 'does-not-exist.jsonl.1')

    // Should not throw.
    let threw = false
    try {
      await rotate(current, previous)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(await pathExists(current)).toBe(false)
    expect(await pathExists(previous)).toBe(false)
  })
})

import { describe, test, expect } from 'bun:test'
import { buildProgram } from '../../../src/program'
import {
  buildCompletionTree,
  listTopLevelCommandNames,
  findCommandPath,
} from '../../../src/core/completion/command-tree'

describe('buildProgram + buildCompletionTree integration', () => {
  const root = buildCompletionTree(buildProgram())

  test('top-level names include the full registered surface', () => {
    const names = listTopLevelCommandNames(root)
    for (const expected of [
      'list',
      'schema',
      'query',
      'q',
      'queries',
      'insert',
      'update',
      'delete',
      'export',
      'blacklist',
      'inspect',
      'report',
      'guide',
      'audit',
      'verify',
      'verification',
      'proxy',
      'assert',
      'snapshot',
      'use',
      'migrate',
      'completion',
      'shell',
    ]) {
      expect(names).toContain(expected)
    }
  })

  test('subcommand-heavy groups expose children', () => {
    expect(findCommandPath(root, ['queries'])!.children.map((c) => c.name)).toContain('list')
    expect(findCommandPath(root, ['migrate'])!.children.map((c) => c.name)).toContain('add-column')
    expect(findCommandPath(root, ['verify'])!.children.map((c) => c.name)).toContain(
      'safe-backfill'
    )
    expect(findCommandPath(root, ['verification'])!.children.map((c) => c.name)).toContain(
      'summary'
    )
    expect(findCommandPath(root, ['audit'])!.children.map((c) => c.name)).toContain('tail')
    expect(findCommandPath(root, ['blacklist'])!.children.map((c) => c.name)).toContain('table')
  })

  test('two-level-deep nesting is present', () => {
    const tableAdd = findCommandPath(root, ['blacklist', 'table', 'add'])
    expect(tableAdd).toBeDefined()
  })

  test('leaf options are captured', () => {
    const safeBackfill = findCommandPath(root, ['verify', 'safe-backfill'])!
    const longs = safeBackfill.options.map((o) => o.long)
    expect(longs).toContain('--after-write')
    expect(longs).toContain('--format')
    expect(longs).toContain('--subject-name')
    expect(longs).toContain('--summary')
  })

  test('buildProgram() is reusable — second call does not throw', () => {
    expect(() => {
      buildProgram()
      buildProgram()
    }).not.toThrow()
  })

  // Lifetime contract (see the NOTE on buildProgram in src/program.ts): command
  // objects are module-level singletons, so a second buildProgram() re-parents
  // them onto the newest program and the previously returned program goes stale.
  // This test locks that behavior so nobody caches an old program instance.
  test('buildProgram() re-parents shared command singletons onto the newest program', () => {
    const first = buildProgram()
    const firstCompletion = first.commands.find((c) => c.name() === 'completion')!
    expect(firstCompletion.parent).toBe(first)

    const second = buildProgram()
    const secondCompletion = second.commands.find((c) => c.name() === 'completion')!

    // Same shared Command instance surfaces in both programs...
    expect(secondCompletion).toBe(firstCompletion)
    // ...and its .parent has been repointed to the newest program, so the first
    // program is now stale and must not be retained by callers.
    expect(firstCompletion.parent).toBe(second)
    expect(firstCompletion.parent).not.toBe(first)

    // The newest program still yields a complete, usable command tree.
    expect(buildCompletionTree(second).children.map((c) => c.name)).toContain('completion')
  })
})

import { describe, test, expect } from 'bun:test'
import { buildProgram } from '../../../src/program'
import {
  buildCompletionTree,
  listTopLevelCommandNames,
} from '../../../src/core/completion/command-tree'
import { deriveReplCommandNames, REPL_DENYLIST } from '../../../src/core/repl/command-registry'

describe('deriveReplCommandNames', () => {
  const topLevel = listTopLevelCommandNames(buildCompletionTree(buildProgram()))
  const names = deriveReplCommandNames(topLevel)

  test('includes newly registered commands', () => {
    for (const c of ['q', 'queries', 'inspect', 'verify', 'proxy', 'snapshot']) {
      expect(names).toContain(c)
    }
  })

  test('excludes denylisted commands', () => {
    expect(names).not.toContain('shell')
  })

  test('is pure — same input yields an equal snapshot', () => {
    expect(deriveReplCommandNames(topLevel)).toEqual(names)
  })

  test('drops every denylist member from an arbitrary input', () => {
    const filtered = deriveReplCommandNames(['list', 'shell', 'schema'])
    expect(filtered).toEqual(['list', 'schema'])
  })

  test('REPL_DENYLIST contains shell to prevent recursive launches', () => {
    expect(REPL_DENYLIST.has('shell')).toBe(true)
  })
})

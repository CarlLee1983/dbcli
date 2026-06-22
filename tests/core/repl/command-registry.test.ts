import { describe, test, expect } from 'bun:test'
import { buildProgram } from '../../../src/program'
import {
  buildCompletionTree,
  listTopLevelCommandNames,
} from '../../../src/core/completion/command-tree'
import {
  setReplCommandNames,
  getReplCommandNames,
  isReplCommandKnown,
} from '../../../src/core/repl/command-registry'

describe('REPL command registry parity', () => {
  const top = listTopLevelCommandNames(buildCompletionTree(buildProgram()))
  setReplCommandNames(top)

  test('completion list includes newly registered commands', () => {
    const names = getReplCommandNames()
    for (const c of ['q', 'queries', 'inspect', 'verify', 'proxy', 'snapshot']) {
      expect(names).toContain(c)
    }
  })

  test('dispatch recognizes the same set', () => {
    expect(isReplCommandKnown('queries')).toBe(true)
    expect(isReplCommandKnown('verify')).toBe(true)
    expect(isReplCommandKnown('snapshot')).toBe(true)
  })

  test('shell is denylisted from dispatch but never crashes', () => {
    expect(isReplCommandKnown('shell')).toBe(false)
  })

  test('completion list excludes denylisted commands', () => {
    expect(getReplCommandNames()).not.toContain('shell')
  })

  test('unknown command is not dispatchable', () => {
    expect(isReplCommandKnown('definitely-not-a-command')).toBe(false)
  })
})

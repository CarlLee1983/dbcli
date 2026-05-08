import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { resolveAgentTaskDirs, taskNameToFile } from '@/core/agent-tasks/task-paths'

const ROOT = '/tmp/proj'

describe('resolveAgentTaskDirs', () => {
  test('returns three tiers under workspace root', () => {
    const dirs = resolveAgentTaskDirs(ROOT)
    expect(dirs.sharedDir).toBe(join(ROOT, '.dbcli-shared', 'tasks'))
    expect(dirs.localDir).toBe(join(ROOT, '.dbcli', 'tasks'))
    expect(dirs.builtinDir.endsWith(join('assets', 'tasks'))).toBe(true)
  })
})

describe('taskNameToFile', () => {
  test('maps simple name to .md file', () => {
    expect(taskNameToFile(ROOT, 'diagnose-slow-query', 'shared')).toBe(
      join(ROOT, '.dbcli-shared', 'tasks', 'diagnose-slow-query.md')
    )
    expect(taskNameToFile(ROOT, 'diag/long-running', 'local')).toBe(
      join(ROOT, '.dbcli', 'tasks', 'diag', 'long-running.md')
    )
  })

  test('builtin path resolves under packaged assets', () => {
    const p = taskNameToFile(ROOT, 'sample', 'builtin')
    expect(p.endsWith(join('assets', 'tasks', 'sample.md'))).toBe(true)
  })
})

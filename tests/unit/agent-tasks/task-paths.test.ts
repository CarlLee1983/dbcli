import { describe, test, expect } from 'bun:test'
import { resolveAgentTaskDirs, taskNameToFile } from '@/core/agent-tasks/task-paths'

describe('resolveAgentTaskDirs', () => {
  test('returns three tiers under workspace root', () => {
    const dirs = resolveAgentTaskDirs('/tmp/proj')
    expect(dirs.sharedDir).toBe('/tmp/proj/.dbcli-shared/tasks')
    expect(dirs.localDir).toBe('/tmp/proj/.dbcli/tasks')
    expect(dirs.builtinDir.endsWith('assets/tasks')).toBe(true)
  })
})

describe('taskNameToFile', () => {
  test('maps simple name to .md file', () => {
    expect(taskNameToFile('/tmp/proj', 'diagnose-slow-query', 'shared')).toBe(
      '/tmp/proj/.dbcli-shared/tasks/diagnose-slow-query.md'
    )
    expect(taskNameToFile('/tmp/proj', 'diag/long-running', 'local')).toBe(
      '/tmp/proj/.dbcli/tasks/diag/long-running.md'
    )
  })

  test('builtin path resolves under packaged assets', () => {
    const p = taskNameToFile('/tmp/proj', 'sample', 'builtin')
    expect(p.endsWith('assets/tasks/sample.md')).toBe(true)
  })
})

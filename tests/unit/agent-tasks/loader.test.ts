import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { loadAgentTasks } from '@/core/agent-tasks/loader'

const fixtures = join(import.meta.dir, '..', '..', 'fixtures', 'agent-tasks')
const NONE = join(fixtures, '__none__')

describe('loadAgentTasks', () => {
  test('walks all three tiers and merges with override semantics', async () => {
    const map = await loadAgentTasks({
      builtinDir: join(fixtures, 'builtin'),
      sharedDir: join(fixtures, 'shared'),
      localDir: join(fixtures, 'local'),
    })
    const sample = map.get('sample')!
    expect(sample.task.source).toBe('local')
    expect(sample.task.description).toBe('Local override (final)')
    expect(sample.hasOverride).toBe(true)
    const diag = map.get('diag/inspect')!
    expect(diag.task.source).toBe('builtin')
    expect(diag.hasOverride).toBe(false)
  })

  test('shared overrides builtin when local is absent', async () => {
    const map = await loadAgentTasks({
      builtinDir: join(fixtures, 'builtin'),
      sharedDir: join(fixtures, 'shared'),
      localDir: NONE,
    })
    const sample = map.get('sample')!
    expect(sample.task.source).toBe('shared')
    expect(sample.hasOverride).toBe(true)
  })

  test('lists builtin tasks when shared/local missing', async () => {
    const map = await loadAgentTasks({
      builtinDir: join(fixtures, 'builtin'),
      sharedDir: NONE,
      localDir: NONE,
    })
    expect([...map.keys()].sort()).toEqual(['diag/inspect', 'sample'])
  })

  test('ignores missing directories silently', async () => {
    const map = await loadAgentTasks({ builtinDir: NONE, sharedDir: NONE, localDir: NONE })
    expect(map.size).toBe(0)
  })

  test('reports parse errors with file path when collectErrors=true', async () => {
    const result = await loadAgentTasks(
      { builtinDir: join(fixtures, 'invalid'), sharedDir: NONE, localDir: NONE },
      { collectErrors: true }
    )
    expect(result.size).toBe(0)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
    expect(result.errors.every((e) => e.file)).toBe(true)
  })
})

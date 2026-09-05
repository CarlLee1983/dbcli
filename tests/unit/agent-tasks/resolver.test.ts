import { describe, test, expect } from 'bun:test'
import { filterTasks, resolveTaskByName } from '@/core/agent-tasks/resolver'
import { AgentTaskError, type AgentTask } from '@/core/agent-tasks/types'
import type { LoadedTask } from '@/core/agent-tasks/loader'

const t = (over: Partial<AgentTask>): AgentTask => ({
  name: 'sample',
  tags: [],
  params: [],
  safety: { mode: 'plan-only' },
  steps: [{ type: 'command', command: 'blacklist list' }],
  source: 'builtin',
  file: '/x.md',
  ...over,
})

const wrap = (task: AgentTask, hasOverride = false): LoadedTask => ({ task, hasOverride })

describe('filterTasks', () => {
  const map = new Map<string, LoadedTask>([
    ['a', wrap(t({ name: 'a', tags: ['diag'], engines: ['postgresql'] }))],
    ['b', wrap(t({ name: 'b', tags: ['ops'], engines: ['mongodb'], source: 'shared' }), true)],
    ['c', wrap(t({ name: 'c', tags: ['diag', 'ops'], source: 'local' }))],
  ])

  test('returns all when no filter', () => {
    expect(
      filterTasks(map, {})
        .map((x) => x.task.name)
        .sort()
    ).toEqual(['a', 'b', 'c'])
  })

  test('filters by tag', () => {
    expect(
      filterTasks(map, { tag: 'ops' })
        .map((x) => x.task.name)
        .sort()
    ).toEqual(['b', 'c'])
  })

  test('filters by engine (engine-agnostic tasks always match)', () => {
    const out = filterTasks(map, { engine: 'postgresql' })
      .map((x) => x.task.name)
      .sort()
    expect(out).toEqual(['a', 'c'])
  })

  test('filters by source', () => {
    expect(filterTasks(map, { source: 'shared' }).map((x) => x.task.name)).toEqual(['b'])
  })

  test('combines filters', () => {
    expect(
      filterTasks(map, { tag: 'diag', engine: 'postgresql' })
        .map((x) => x.task.name)
        .sort()
    ).toEqual(['a', 'c'])
  })
})

describe('resolveTaskByName', () => {
  const map = new Map<string, LoadedTask>([
    ['diagnose-slow-query', wrap(t({ name: 'diagnose-slow-query' }))],
    ['ops/cleanup', wrap(t({ name: 'ops/cleanup' }))],
  ])

  test('returns the task by exact name', () => {
    expect(resolveTaskByName(map, 'diagnose-slow-query').task.name).toBe('diagnose-slow-query')
  })

  test('throws NOT_FOUND with suggestions', () => {
    try {
      resolveTaskByName(map, 'diagnose-slow-quer')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AgentTaskError)
      expect((e as AgentTaskError).code).toBe('NOT_FOUND')
      expect((e as AgentTaskError).message).toMatch(/diagnose-slow-query/)
    }
  })
})

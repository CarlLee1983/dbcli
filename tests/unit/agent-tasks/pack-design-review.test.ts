import { describe, expect, test } from 'bun:test'
import {
  loadAgentTasks,
  planAgentTask,
  resolveAgentTaskDirs,
  resolveTaskByName,
} from '@/core/agent-tasks'

describe('builtin pack: design-review', () => {
  test('plans only design review, cache comparison, and review-only proposal steps', async () => {
    const tasks = await loadAgentTasks(resolveAgentTaskDirs(process.cwd()))
    const entry = resolveTaskByName(tasks, 'design-review')
    const plan = planAgentTask({ task: entry.task, params: {} })

    expect(plan.mode).toBe('plan-only')
    expect(plan.requires).toEqual(['blacklist.manage', 'schema.read'])
    expect(plan.steps.map((step) => step.resolvedCommand)).toEqual([
      'blacklist list',
      'design validate --format json',
      'design render --format mermaid',
      'schema --format json',
      'design diff --against-cache --format markdown',
      'design propose --against-cache --format markdown',
    ])
    expect(plan.steps.every((step) => step.risk === 'readonly')).toBe(true)
  })
})

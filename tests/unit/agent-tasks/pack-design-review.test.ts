import { describe, expect, test } from 'bun:test'
import { loadAgentTasks, planAgentTask, resolveAgentTaskDirs, resolveTaskByName } from '@/core/agent-tasks'

describe('builtin pack: design-review', () => {
  test('plans only offline design review and cache comparison steps', async () => {
    const tasks = await loadAgentTasks(resolveAgentTaskDirs(process.cwd()))
    const entry = resolveTaskByName(tasks, 'design-review')
    const plan = planAgentTask({ task: entry.task, params: {} })

    expect(plan.mode).toBe('plan-only')
    expect(plan.steps.map((step) => step.resolvedCommand)).toEqual([
      'design validate --format json',
      'design render --format mermaid',
      'schema --format json',
      'design diff --against-cache --format markdown',
    ])
    expect(plan.steps.every((step) => step.risk === 'readonly')).toBe(true)
  })
})

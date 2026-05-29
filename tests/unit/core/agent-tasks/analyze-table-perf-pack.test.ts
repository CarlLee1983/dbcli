import { describe, test, expect } from 'bun:test'
import { loadAgentTasks, resolveAgentTaskDirs } from '@/core/agent-tasks'

describe('analyze-table-perf builtin task pack', () => {
  test('loads and exposes a required `table` param', async () => {
    const map = await loadAgentTasks(resolveAgentTaskDirs(process.cwd()))
    const entry = map.get('analyze-table-perf')
    expect(entry).toBeDefined()
    const task = entry!.task
    expect(task.safety.mode).toBe('plan-only')
    const tableParam = task.params.find((p) => p.name === 'table')
    expect(tableParam).toBeDefined()
    expect(tableParam!.required).toBe(true)
    expect(task.steps.length).toBeGreaterThan(0)
    for (const s of task.steps) expect(s.risk).toBe('readonly')
  })
})

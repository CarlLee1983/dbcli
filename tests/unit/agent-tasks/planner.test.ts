import { describe, test, expect } from 'bun:test'
import { planAgentTask, renderMarkdownPlan } from '@/core/agent-tasks/planner'
import { AgentTaskError, type AgentTask } from '@/core/agent-tasks/types'

const buildTask = (over: Partial<AgentTask> = {}): AgentTask => ({
  name: 'diagnose-slow-query',
  description: 'Diagnose slow queries.',
  tags: [],
  params: [
    { name: 'query', type: 'string', required: true, description: 'SQL or fingerprint' },
    { name: 'days', type: 'number', required: false, default: 7 },
  ],
  safety: { mode: 'plan-only', requires: ['blacklist.manage'] },
  steps: [
    {
      type: 'command',
      command: 'blacklist list',
      reason: 'Confirm sensitive tables are protected.',
      risk: 'readonly',
    },
    {
      type: 'command',
      command: 'plan "{{query}}"',
      reason: 'Analyze SQL risk.',
      risk: 'readonly',
    },
    {
      type: 'command',
      command: 'q @diag/long-running --param min_seconds={{days}} --format json',
      risk: 'readonly',
    },
  ],
  source: 'builtin',
  file: '/x/diagnose-slow-query.md',
  ...over,
})

describe('planAgentTask', () => {
  test('produces stable plan with resolved templates and argv', () => {
    const plan = planAgentTask({
      task: buildTask(),
      params: { query: 'SELECT * FROM orders' },
    })
    expect(plan.parameters).toEqual({ query: 'SELECT * FROM orders', days: 7 })
    expect(plan.warnings).toEqual([])
    expect(plan.steps[0]).toEqual({
      command: 'blacklist list',
      resolvedCommand: 'blacklist list',
      argv: ['blacklist', 'list'],
      reason: 'Confirm sensitive tables are protected.',
      risk: 'readonly',
    })
    expect(plan.steps[1]?.resolvedCommand).toBe('plan "SELECT * FROM orders"')
    expect(plan.steps[1]?.argv).toEqual(['plan', 'SELECT * FROM orders'])
    expect(plan.steps[2]?.resolvedCommand).toBe(
      'q @diag/long-running --param min_seconds=7 --format json'
    )
  })

  test('fails when required parameter is missing', () => {
    expect(() => planAgentTask({ task: buildTask(), params: {} })).toThrow(AgentTaskError)
  })

  test('warns on unknown provided parameter', () => {
    const plan = planAgentTask({
      task: buildTask(),
      params: { query: 'x', surprise: 'extra' },
    })
    expect(plan.warnings.some((w) => /surprise/.test(w))).toBe(true)
  })

  test('coerces param types', () => {
    const plan = planAgentTask({
      task: buildTask(),
      params: { query: 'x', days: '3' },
    })
    expect(plan.parameters.days).toBe(3)
  })

  test('rejects param value not in enum', () => {
    const task = buildTask({
      params: [{ name: 'mode', type: 'string', required: true, enum: ['safe', 'risky'] }],
      steps: [{ type: 'command', command: 'plan "{{mode}}"' }],
    })
    expect(() => planAgentTask({ task, params: { mode: 'wild' } })).toThrow(/enum/i)
  })

  test('rejects unresolved template (typo)', () => {
    const task = buildTask({
      params: [{ name: 'query', type: 'string', required: true }],
      steps: [{ type: 'command', command: 'plan "{{quary}}"' }],
    })
    expect(() => planAgentTask({ task, params: { query: 'x' } })).toThrow(/quary/)
  })
})

describe('renderMarkdownPlan', () => {
  test('contains task identity, parameters, steps, and rationale', () => {
    const plan = planAgentTask({
      task: buildTask(),
      params: { query: 'SELECT 1' },
    })
    const md = renderMarkdownPlan(plan)
    expect(md).toContain('diagnose-slow-query')
    expect(md).toContain('plan-only')
    expect(md).toContain('blacklist.manage')
    expect(md).toContain('query: SELECT 1')
    expect(md).toContain('plan "SELECT 1"')
    expect(md).toContain('Confirm sensitive tables are protected.')
  })
})

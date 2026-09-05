import { describe, test, expect } from 'bun:test'
import { parseAgentTask } from '@/core/agent-tasks/parser'
import { AgentTaskError } from '@/core/agent-tasks/types'

const wrap = (fm: string, body = ''): string => `---\n${fm}\n---\n${body}`

describe('parseAgentTask — happy path', () => {
  test('parses full task definition', () => {
    const text = wrap(
      [
        'name: diagnose-slow-query',
        'description: Diagnose slow query.',
        'tags: [diagnostics, performance]',
        'engines: [postgresql, mysql]',
        'params:',
        '  query:',
        '    type: string',
        '    required: true',
        '    description: SQL or fingerprint.',
        'safety:',
        '  mode: plan-only',
        '  requires: [blacklist.manage]',
        'steps:',
        '  - type: command',
        '    command: blacklist list',
        '    reason: Confirm sensitive data is protected.',
        '    risk: readonly',
      ].join('\n'),
      '# Agent Notes\n\nUse for slow queries.\n'
    )
    const out = parseAgentTask({
      name: 'diagnose-slow-query',
      file: '/x/diagnose-slow-query.md',
      source: 'builtin',
      text,
    })
    expect(out.name).toBe('diagnose-slow-query')
    expect(out.description).toBe('Diagnose slow query.')
    expect(out.tags).toEqual(['diagnostics', 'performance'])
    expect(out.engines).toEqual(['postgresql', 'mysql'])
    expect(out.params).toEqual([
      {
        name: 'query',
        type: 'string',
        required: true,
        description: 'SQL or fingerprint.',
      },
    ])
    expect(out.safety).toEqual({ mode: 'plan-only', requires: ['blacklist.manage'] })
    expect(out.steps).toEqual([
      {
        type: 'command',
        command: 'blacklist list',
        reason: 'Confirm sensitive data is protected.',
        risk: 'readonly',
      },
    ])
    expect(out.notes).toContain('Use for slow queries.')
    expect(out.source).toBe('builtin')
    expect(out.file).toBe('/x/diagnose-slow-query.md')
  })

  test('defaults required=false when default is provided', () => {
    const text = wrap(
      [
        'name: t',
        'safety:',
        '  mode: plan-only',
        'params:',
        '  days:',
        '    type: number',
        '    default: 7',
        'steps:',
        '  - type: command',
        '    command: blacklist list',
      ].join('\n')
    )
    const out = parseAgentTask({ name: 't', file: 't.md', source: 'shared', text })
    expect(out.params[0]).toEqual({
      name: 'days',
      type: 'number',
      required: false,
      default: 7,
    })
  })
})

describe('parseAgentTask — failures', () => {
  const must = (fm: string) =>
    parseAgentTask({ name: 't', file: 't.md', source: 'shared', text: wrap(fm) })

  test('rejects missing name', () => {
    expect(() =>
      must(
        [
          'safety:',
          '  mode: plan-only',
          'steps:',
          '  - type: command',
          '    command: blacklist list',
        ].join('\n')
      )
    ).toThrow(AgentTaskError)
  })

  test('rejects mismatched name vs filename', () => {
    expect(() =>
      parseAgentTask({
        name: 'expected-name',
        file: 'expected-name.md',
        source: 'shared',
        text: wrap(
          [
            'name: other-name',
            'safety:',
            '  mode: plan-only',
            'steps:',
            '  - type: command',
            '    command: blacklist list',
          ].join('\n')
        ),
      })
    ).toThrow(/name/i)
  })

  test('rejects unknown safety.mode', () => {
    expect(() =>
      must(
        [
          'name: t',
          'safety:',
          '  mode: run',
          'steps:',
          '  - type: command',
          '    command: blacklist list',
        ].join('\n')
      )
    ).toThrow(/plan-only/)
  })

  test('rejects unknown capability requirements and gives legacy packs a migration', () => {
    const base = [
      'name: t',
      'safety:',
      '  mode: plan-only',
      '  requires: [blacklist-list]',
      'steps:',
      '  - type: command',
      '    command: blacklist list',
    ].join('\n')
    expect(() => must(base)).toThrow(/replace it with 'blacklist.manage'/)
    expect(() => must(base.replace('blacklist-list', 'not.a.capability'))).toThrow(
      /unknown capability/
    )
  })

  test('normalizes the legacy postgres engine spelling to postgresql', () => {
    const task = parseAgentTask({
      name: 't',
      file: 't.md',
      source: 'shared',
      text: wrap(
        [
          'name: t',
          'engines: [postgres]',
          'safety:',
          '  mode: plan-only',
          'steps:',
          '  - type: command',
          '    command: blacklist list',
        ].join('\n')
      ),
    })
    expect(task.engines).toEqual(['postgresql'])
  })

  test('rejects unknown step.type', () => {
    expect(() =>
      must(
        [
          'name: t',
          'safety:',
          '  mode: plan-only',
          'steps:',
          '  - type: shell',
          '    command: rm -rf /',
        ].join('\n')
      )
    ).toThrow(/command/)
  })

  test('rejects empty steps', () => {
    expect(() => must(['name: t', 'safety:', '  mode: plan-only', 'steps: []'].join('\n'))).toThrow(
      /step/i
    )
  })

  test('rejects unknown engine', () => {
    expect(() =>
      must(
        [
          'name: t',
          'engines: [oracle]',
          'safety:',
          '  mode: plan-only',
          'steps:',
          '  - type: command',
          '    command: blacklist list',
        ].join('\n')
      )
    ).toThrow(/engine/i)
  })

  test('rejects bad param type', () => {
    expect(() =>
      must(
        [
          'name: t',
          'safety:',
          '  mode: plan-only',
          'params:',
          '  q:',
          '    type: object',
          'steps:',
          '  - type: command',
          '    command: blacklist list',
        ].join('\n')
      )
    ).toThrow(/type/)
  })

  test('rejects task with no frontmatter', () => {
    expect(() =>
      parseAgentTask({
        name: 't',
        file: 't.md',
        source: 'shared',
        text: '# just markdown\n',
      })
    ).toThrow(AgentTaskError)
  })
})

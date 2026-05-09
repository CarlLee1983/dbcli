import { describe, test, expect } from 'bun:test'
import type { GuideStep } from '@/core/guide/types'

describe('GuideStep additive fields (v1.17.0)', () => {
  test('accepts interactive flag', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli init',
      rationale: 'create config',
      risk: 'write',
      expects: 'wizard prompts',
      interactive: true,
    }
    expect(s.interactive).toBe(true)
  })

  test('accepts dbWrite flag', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli update foo --where id=1 --set {}',
      rationale: 'mutate row',
      risk: 'write',
      expects: 'rows affected = 1',
      dbWrite: true,
    }
    expect(s.dbWrite).toBe(true)
  })

  test('accepts placeholders array', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli schema <table> --format json',
      rationale: 'inspect',
      risk: 'readonly',
      expects: 'schema json',
      placeholders: ['<table>'],
    }
    expect(s.placeholders).toEqual(['<table>'])
  })

  test('all three fields are optional (existing v1.16 shape still compiles)', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli inspect --for-agent',
      rationale: 'snapshot',
      risk: 'readonly',
      expects: 'json',
    }
    expect(s.interactive).toBeUndefined()
    expect(s.dbWrite).toBeUndefined()
    expect(s.placeholders).toBeUndefined()
  })
})

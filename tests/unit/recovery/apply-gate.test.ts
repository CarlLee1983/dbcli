import { describe, test, expect } from 'bun:test'
import { classifyStep } from '@/core/recovery/apply-gate'
import type { GuideStep } from '@/core/guide/types'

const baseStep: GuideStep = {
  order: 1,
  command: 'dbcli inspect --for-agent',
  rationale: 'snapshot',
  risk: 'readonly',
  expects: 'json',
}

describe('classifyStep', () => {
  test('readonly step always runs', () => {
    expect(classifyStep(baseStep, 'none', 'UNKNOWN').kind).toBe('run')
    expect(classifyStep(baseStep, 'readonly-cmd', 'UNKNOWN').kind).toBe('run')
    expect(classifyStep(baseStep, 'write-cmd', 'UNKNOWN').kind).toBe('run')
  })

  test('dry-run step always runs', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli q @x --dry-run',
      risk: 'dry-run',
    }
    expect(classifyStep(s, 'none', 'SNIPPET_AMBIGUOUS').kind).toBe('run')
  })

  test('write step (dbWrite=false) skipped on default, runs on readonly-cmd', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli blacklist remove orders',
      risk: 'write',
    }
    expect(classifyStep(s, 'none', 'BLACKLIST_TABLE').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'readonly-cmd', 'BLACKLIST_TABLE').kind).toBe('run')
    expect(classifyStep(s, 'write-cmd', 'BLACKLIST_TABLE').kind).toBe('run')
  })

  test('write step (dbWrite=true) only runs on write-cmd', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli update orders --where id=1 --set name=foo',
      risk: 'write',
      dbWrite: true,
    }
    expect(classifyStep(s, 'none', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'readonly-cmd', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'write-cmd', 'PERMISSION_DENIED').kind).toBe('run')
  })

  test('interactive wins over risk regardless of allow-write tier', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli init --force',
      risk: 'write',
      interactive: true,
    }
    for (const tier of ['none', 'readonly-cmd', 'write-cmd'] as const) {
      expect(classifyStep(s, tier, 'PERMISSION_DENIED').kind).toBe('skipped:interactive')
    }
  })

  test('placeholder wins over risk', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli blacklist remove <table>',
      risk: 'write',
      placeholders: ['<table>'],
    }
    expect(classifyStep(s, 'write-cmd', 'BLACKLIST_TABLE').kind).toBe('skipped:placeholder')
  })

  test('placeholder detected by literal token scan even when placeholders array is absent', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli schema <table> --format json',
      risk: 'readonly',
    }
    expect(classifyStep(s, 'none', 'BLACKLIST_COLUMN_WRITE').kind).toBe('skipped:placeholder')
  })

  test('unsafe-command wins over risk (parse failure)', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli inspect; ls',
      risk: 'readonly',
    }
    expect(classifyStep(s, 'none', 'UNKNOWN').kind).toBe('skipped:unsafe-command')
  })

  test('unsafe-command wins over risk (allowlist miss)', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli query SELECT 1',
      risk: 'readonly',
    }
    expect(classifyStep(s, 'none', 'CONFIG_MISSING').kind).toBe('skipped:unsafe-command')
  })

  test('precedence: interactive over placeholder over unsafe over risk', () => {
    const s: GuideStep = {
      ...baseStep,
      command: 'dbcli init <foo>; ls',
      risk: 'write',
      interactive: true,
      placeholders: ['<foo>'],
    }
    expect(classifyStep(s, 'none', 'CONFIG_MISSING').kind).toBe('skipped:interactive')
  })
})

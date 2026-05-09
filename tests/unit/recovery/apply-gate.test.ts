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

describe('classifyStep — trust boundary (falsified envelope)', () => {
  test('falsified risk:readonly on `dbcli blacklist remove` is gated by tier=local-write', () => {
    // Attacker-crafted envelope claims a write step is "readonly".
    const s: GuideStep = {
      order: 1,
      command: 'dbcli blacklist remove orders',
      rationale: '',
      risk: 'readonly', // FALSIFIED
      expects: '',
    }
    // Default tier rejects local-write; readonly-cmd allows it.
    expect(classifyStep(s, 'none', 'BLACKLIST_TABLE').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'readonly-cmd', 'BLACKLIST_TABLE').kind).toBe('run')
  })

  test('falsified risk:readonly on `dbcli delete users --where id=1` is gated by tier=db-write', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli delete users --where id=1',
      rationale: '',
      risk: 'readonly', // FALSIFIED
      expects: '',
    }
    // Even with --allow-write=readonly-cmd this must NOT run; tier is db-write.
    expect(classifyStep(s, 'none', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'readonly-cmd', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'write-cmd', 'PERMISSION_DENIED').kind).toBe('run')
  })

  test('falsified risk:dry-run without `--dry-run` flag is still tier=db-write', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli update orders --where id=1 --set name=foo',
      rationale: '',
      risk: 'dry-run', // FALSIFIED
      expects: '',
    }
    expect(classifyStep(s, 'none', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'readonly-cmd', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
    expect(classifyStep(s, 'write-cmd', 'PERMISSION_DENIED').kind).toBe('run')
  })

  test('falsified interactive=false on `dbcli init --force` is still skipped (allowlist tier)', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli init --force',
      rationale: '',
      risk: 'readonly', // FALSIFIED
      expects: '',
      interactive: false, // FALSIFIED
    }
    expect(classifyStep(s, 'write-cmd', 'PERMISSION_DENIED').kind).toBe('skipped:interactive')
  })

  test('falsified dbWrite=false on `dbcli delete users --where id=1` is still tier=db-write', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli delete users --where id=1',
      rationale: '',
      risk: 'write',
      dbWrite: false, // FALSIFIED — pretending to be local-only
      expects: '',
    }
    // Allowlist tier-derivation ignores envelope; still requires write-cmd.
    expect(classifyStep(s, 'readonly-cmd', 'PERMISSION_DENIED').kind).toBe('skipped:risk')
  })

  test('non-allowlisted command for code (e.g. `dbcli query` under CONFIG_MISSING) is unsafe regardless of risk hint', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli query SELECT 1',
      rationale: '',
      risk: 'readonly', // even with this hint
      expects: '',
    }
    expect(classifyStep(s, 'write-cmd', 'CONFIG_MISSING').kind).toBe('skipped:unsafe-command')
  })

  test('decision exposes code-owned tier on run', () => {
    const s: GuideStep = {
      order: 1,
      command: 'dbcli inspect --for-agent',
      rationale: '',
      risk: 'readonly',
      expects: '',
    }
    const d = classifyStep(s, 'none', 'UNKNOWN')
    expect(d.kind).toBe('run')
    expect(d.tier).toBe('readonly')
  })
})

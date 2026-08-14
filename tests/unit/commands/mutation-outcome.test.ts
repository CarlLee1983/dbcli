/**
 * The human-facing summary of a finished mutation, and the rule deciding when
 * a human sees it at all.
 *
 * Assertions here name the load-bearing parts — the count, the table, the
 * outcome — rather than whole sentences, so the copy can be reworded without
 * editing tests. The exception is renderMutationOutcome returning no lines at
 * all, which is the guarantee the machine path rests on.
 */

import { describe, test, expect } from 'bun:test'
import { renderMutationOutcome, shouldRenderForHuman } from '@/commands/mutation-outcome'
import type { DataExecutionResult } from '@/types/data'

const result = (over: Partial<DataExecutionResult> = {}): DataExecutionResult => ({
  status: 'success',
  operation: 'update',
  rows_affected: 3,
  timestamp: '2026-08-14T00:00:00.000Z',
  sql: 'UPDATE "users" SET "amount" = $1 WHERE "id" = $2',
  ...over,
})

describe('shouldRenderForHuman', () => {
  test('renders for a terminal', () => {
    expect(shouldRenderForHuman({ isTTY: true })).toBe(true)
  })

  test('does not render when stdout is not a terminal', () => {
    expect(shouldRenderForHuman({ isTTY: false })).toBe(false)
  })

  test('an explicit json format wins over a terminal', () => {
    // Asking for machine format is an unambiguous statement of intent, so it
    // outranks the guess that a terminal implies a reader.
    expect(shouldRenderForHuman({ isTTY: true, format: 'json' })).toBe(false)
  })

  test('an explicit text format does not force output into a pipe', () => {
    // 'text' is the flag's default, so it carries no intent — treating it as a
    // request would put prose into every redirect.
    expect(shouldRenderForHuman({ isTTY: false, format: 'text' })).toBe(false)
  })
})

describe('renderMutationOutcome', () => {
  test('a write names the rows it touched and the table', () => {
    const lines = renderMutationOutcome(result(), 'users', 120)

    expect(lines[0]).toContain('3')
    expect(lines[0]).toContain('users')
    expect(lines.join('\n')).toContain('0.12')
  })

  test('a write that matched nothing says so rather than reporting zero rows', () => {
    const lines = renderMutationOutcome(result({ rows_affected: 0 }), 'users', 50)

    expect(lines[0].toLowerCase()).toContain('no rows')
    expect(lines[0]).toContain('users')
  })

  test('a cancelled mutation states that nothing changed', () => {
    const lines = renderMutationOutcome(
      result({ status: 'cancelled', rows_affected: 0 }),
      'users',
      5
    )

    expect(lines[0].toLowerCase()).toContain('cancel')
    expect(lines[0]).toContain('users')
  })

  test('a dry run states that nothing changed', () => {
    const lines = renderMutationOutcome(result({ status: 'dry_run', rows_affected: 0 }), 'users', 5)

    expect(lines[0].toLowerCase()).toContain('preview')
  })

  test('a failure leads with the reason', () => {
    const lines = renderMutationOutcome(
      result({ status: 'error', rows_affected: 0, error: 'connection refused' }),
      'users',
      5
    )

    expect(lines[0]).toContain('connection refused')
  })

  test('delete and insert are described in their own words', () => {
    expect(renderMutationOutcome(result({ operation: 'delete' }), 'users', 10)[0]).toMatch(/delet/i)
    expect(renderMutationOutcome(result({ operation: 'insert' }), 'users', 10)[0]).toMatch(
      /insert/i
    )
  })

  test('nothing that did not happen is timed', () => {
    // A cancellation has no duration worth reporting; printing one invites the
    // reader to think something ran.
    const lines = renderMutationOutcome(result({ status: 'cancelled' }), 'users', 900)
    expect(lines.join('\n')).not.toContain('0.9')
  })

  test('a write that changed rows says how to get the old values back', () => {
    // The moment somebody needs the recovery story is the moment they have just
    // written, so it belongs here rather than in the documentation.
    const lines = renderMutationOutcome(result(), 'users', 120)
    expect(lines.join('\n').toLowerCase()).toMatch(/undo|backup|還原|備份/)
  })

  test('a failure names the flag that produces a recovery plan', () => {
    const lines = renderMutationOutcome(result({ status: 'error', error: 'boom' }), 'users', 10)
    expect(lines.join('\n')).toContain('--recovery')
  })

  test('outcomes that changed nothing do not discuss reversal', () => {
    // There is nothing to reverse, and a line that appears on every outcome is
    // a line nobody reads on the outcome that needs it.
    for (const over of [
      { status: 'cancelled' as const },
      { status: 'dry_run' as const, rows_affected: 0 },
      { rows_affected: 0 },
    ]) {
      const text = renderMutationOutcome(result(over), 'users', 10).join('\n').toLowerCase()
      expect(text).not.toMatch(/undo|backup|還原|備份/)
    }
  })
})

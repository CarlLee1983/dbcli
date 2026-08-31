/**
 * The sink `dbcli shell` hands to `ReplEngine`.
 *
 * The engine states what happened; this decides where it lands. Tested here
 * rather than through the REPL because the question is what reaches
 * `writeAuditEntryResult` — the field names an operator reads later.
 */
import { describe, expect, test } from 'bun:test'
import { createShellAuditSink } from '@/commands/shell-audit-sink'
import type { DbcliConfig } from '@/utils/validation'
import type { AuditOutcome } from '@/core/audit/integration-helper'

const config = { audit: { enabled: true } } as unknown as DbcliConfig

describe('createShellAuditSink', () => {
  test('phase reaches the entry under the key both shells use', async () => {
    const written: AuditOutcome[] = []
    const sink = createShellAuditSink({
      config,
      configPath: '.dbcli',
      write: async (_config, _command, _options, entry) => {
        written.push(entry)
        return { success: true, rotated: false, id: 'a' }
      },
    })

    await sink({ phase: 'attempt', success: true, statement: 'SELECT 1' })

    expect(written).toHaveLength(1)
    expect(written[0]?.metadata).toEqual({ shell_phase: 'attempt' })
  })

  test('the statement is carried as the operation, not the process argv', async () => {
    // Without it every shell row names its connection and not what was run.
    const written: AuditOutcome[] = []
    const sink = createShellAuditSink({
      config,
      configPath: '.dbcli',
      write: async (_config, _command, _options, entry) => {
        written.push(entry)
        return { success: true, rotated: false, id: 'a' }
      },
    })

    await sink({ phase: 'outcome', success: false, statement: 'DELETE FROM users' })

    expect(written[0]?.sql).toBe('DELETE FROM users')
    expect(written[0]?.success).toBe(false)
  })
})

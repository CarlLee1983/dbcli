/**
 * The audit sink as the interactive SQL shell uses it.
 *
 * `ReplEngine` says what happened; this says where it lands. It lives here and
 * not in `src/core/repl` for the same reason `shell-write-gate.ts` does: ADR
 * 0009 keeps file and stream writes out of core, so the engine takes both as
 * callbacks.
 *
 * Until ADR-0016 the shell wrote nothing but tier-two gate decisions, so a
 * `SELECT` typed at the prompt and an `UPDATE` that changed a row were equally
 * invisible while `dbcli query` recorded both. The phase key is the one the
 * Elasticsearch shell writes, because an operator reading a line should not
 * have to know which engine produced it.
 */

import { writeAuditEntryResult } from '@/core/audit/integration-helper'
import type { ReplAuditSink } from '@/core/repl/types'
import type { DbcliConfig } from '@/utils/validation'

export interface ShellAuditSinkOptions {
  config: DbcliConfig
  configPath: string
  /** Injected by the tests; production passes the real writer. */
  write?: typeof writeAuditEntryResult
}

export function createShellAuditSink(options: ShellAuditSinkOptions): ReplAuditSink {
  const write = options.write ?? writeAuditEntryResult

  return async (record) => {
    return await write(
      options.config,
      'shell',
      { config: options.configPath },
      {
        success: record.success,
        // The operation itself. Without it a row names the connection and not
        // what was run on it.
        sql: record.statement,
        metadata: { shell_phase: record.phase },
      }
    )
  }
}

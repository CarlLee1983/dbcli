/**
 * The write gate as the interactive shell uses it.
 *
 * `dbcli shell` was the last SQL path the gate never reached (#78): the REPL
 * talks to the adapter directly, so `DROP TABLE users` typed at the prompt ran
 * on nothing but a permission check, while the same statement handed to
 * `dbcli query` had to be confirmed by typing the table name. A protection that
 * depends on which entry point the operator picked is the thing #70 set out to
 * remove, not a scope boundary worth keeping.
 *
 * Only tier two is wired. Tier one is a y/N per write, which fits a batch of
 * generated statements and not a person typing one line at a time — the shell
 * would ask on every UPDATE and the answer would become reflex, which is worse
 * than not asking. Tier two costs a table name, and in a shell there is always
 * somebody there to type it.
 *
 * Lives here rather than in `src/core/repl` because it prompts, and ADR 0009
 * keeps every stream write out of core; `ReplEngine` takes this as a callback.
 */

import type { SqlDialect } from '@/core/permission-guard'
import type { ReplWriteGate } from '@/core/repl/types'
import { classifySqlWriteGate } from './write-gate'
import { enforceWriteGate, WriteGateRefusal } from './write-gate-prompt'
import { recordGateDecision, type GateOutcome } from './write-gate-guard'
import type { WriteGateVerdict } from './write-gate'

/** The config shape the audit trail accepts, taken from the recorder itself. */
type AuditableConfig = Parameters<typeof recordGateDecision>[0]['config']

export interface ShellGateDecision {
  verdict: WriteGateVerdict
  outcome: GateOutcome
  tier: 'one' | 'two'
  sql: string
}

export interface ShellWriteGateOptions {
  config: AuditableConfig
  configPath: string
  dialect: SqlDialect
  /** Injectable for tests; production records to the audit log like every other gate. */
  record?: (decision: ShellGateDecision) => Promise<void>
  /**
   * Reads the typed confirmation. The shell supplies its own readline
   * interface's `question`: the REPL already owns the terminal, and a second
   * reader opened on stdin would take the same keystrokes twice — once as the
   * confirmation and once as the next line at the prompt.
   */
  ask?: (question: string) => Promise<string | null>
}

/**
 * Build the callback `ReplEngine` consults before a typed statement executes.
 *
 * Returns false rather than throwing when the statement must not run. A
 * `WriteGateRefusal` propagated out of the REPL would end the session, and
 * ending a shell because one statement was refused loses the buffer, the
 * history position and the connection — the operator is right there and can fix
 * the statement.
 */
export function createShellWriteGate(options: ShellWriteGateOptions): ReplWriteGate {
  const record =
    options.record ??
    ((decision: ShellGateDecision) =>
      recordGateDecision({
        config: options.config,
        command: 'shell',
        options: { config: options.configPath },
        verdict: decision.verdict,
        outcome: decision.outcome,
        tier: decision.tier,
        sql: decision.sql,
      }))

  return async (sql: string): Promise<boolean> => {
    const verdict = await classifySqlWriteGate(sql, { dialect: options.dialect })
    if (verdict.tier !== 'two') return true

    const decide = (outcome: GateOutcome) => record({ verdict, outcome, tier: 'two', sql })

    try {
      const proceed = await enforceWriteGate({
        verdict,
        statement: sql,
        operation: verdict.operation ?? 'WRITE',
        // The shell prompts on stderr and reads stdin, so stdin alone decides
        // whether anybody is there. Asking `process.stdout.isTTY` — what the
        // one-shot commands ask — would refuse `dbcli shell > results.txt`,
        // where a person is at the keyboard the whole time.
        human: { isTTY: process.stdin.isTTY === true },
        ...(options.ask && { ask: options.ask }),
      })
      await decide(proceed ? 'allowed' : 'declined')
      return proceed
    } catch (error) {
      if (!(error instanceof WriteGateRefusal)) throw error
      // Piped input: `dbcli shell < script.sql`. Nobody can answer, so the
      // statement is refused and reported, and the remaining lines still run.
      await decide('refused')
      process.stderr.write(`${error.message}\n`)
      return false
    }
  }
}

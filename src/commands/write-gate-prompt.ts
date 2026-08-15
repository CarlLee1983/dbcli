/**
 * Asking — and refusing — before a raw statement writes.
 *
 * `write-gate.ts` decides what a statement is; this decides what happens about
 * it. The split matters because only this half knows whether a person is
 * watching, and only this half is allowed to write to a stream at all (ADR
 * 0009).
 *
 * Everything here goes to stderr. A question addressed to a person is not part
 * of the result, and stdout is what agents parse — the same reasoning that
 * moved the mutation confirmation out of stdout in #72.
 */

import { t, t_vars } from '@/i18n/message-loader'
import { promptUser } from '@/utils/prompts'
import { shouldRenderForHuman, type HumanOutputContext } from './mutation-outcome'
import type { WriteGateReason, WriteGateVerdict } from './write-gate'

/**
 * A tier-two statement that arrived with nobody to confirm it.
 *
 * Carries a stable `code` and `reason` so a caller can tell this apart from a
 * connection failure or a permission refusal without parsing prose — the
 * distinction an agent has to make to know whether retrying is pointless.
 */
export class WriteGateRefusal extends Error {
  readonly code = 'WRITE_GATE_REFUSED'
  readonly reason: WriteGateReason
  readonly table: string | undefined

  constructor(message: string, reason: WriteGateReason, table?: string) {
    super(message)
    this.name = 'WriteGateRefusal'
    this.reason = reason
    this.table = table
  }
}

const REMEDY_KEY: Record<WriteGateReason, string> = {
  no_where: 'ceremony.gate_remedy_no_where',
  ddl_destruction: 'ceremony.gate_remedy_ddl_destruction',
  unparseable: 'ceremony.gate_remedy_unparseable',
  non_unique_where: 'ceremony.gate_remedy_non_unique_where',
  multiple_statements: 'ceremony.gate_remedy_multiple_statements',
  multi_table: 'ceremony.gate_remedy_multi_table',
}

const WARNING_KEY: Record<WriteGateReason, string> = {
  no_where: 'ceremony.gate_full_table_warning',
  ddl_destruction: 'ceremony.gate_ddl_warning',
  // `ddl_destruction` with no table falls back to the untargeted wording below.
  unparseable: 'ceremony.gate_unparseable_warning',
  non_unique_where: 'ceremony.gate_full_table_warning',
  multiple_statements: 'ceremony.gate_multiple_statements_warning',
  multi_table: 'ceremony.gate_multi_table_warning',
}

export interface WriteGateRequest {
  verdict: WriteGateVerdict
  /** The statement as it will run, shown so the operator can compare intent against text. */
  statement: string
  /** What the tool understood the statement to do — UPDATE, DELETE, DROP. */
  operation: string
  human: HumanOutputContext
  /** `--yes`: skips tier one only. Tier two has no bypass by design. */
  yes?: boolean
  /**
   * How to read the typed confirmation. Defaults to `promptUser.text`, which
   * opens its own reader on stdin — correct for a one-shot command and wrong
   * inside the REPL, where a readline interface already owns the terminal and
   * two readers would split the operator's keystrokes between them. The shell
   * passes its own interface's question here.
   *
   * `null` means the operator withdrew the question — Ctrl-C in the shell —
   * which is a different thing from typing the wrong name and is reported as
   * such.
   */
  ask?: (question: string) => Promise<string | null>
}

/**
 * Run the gate. Returns true when the statement may proceed, false when the
 * operator declined, and throws `WriteGateRefusal` when tier two was reached
 * with nobody to answer it.
 *
 * Declining and being refused are deliberately different outcomes: a person who
 * said no has already been told, while an unattended caller needs a non-zero
 * exit so its own caller learns that nothing ran.
 */
export async function enforceWriteGate(request: WriteGateRequest): Promise<boolean> {
  const { verdict, human } = request
  if (verdict.tier === 'none') return true

  const attended = isAttended(human)

  if (verdict.tier === 'two') return await enforceTierTwo(request, attended)

  if (request.yes === true) return true
  if (!attended) return true

  writeSummary(request)
  const proceed = await promptUser.confirm(t('ceremony.confirm_prompt'))
  if (!proceed) process.stderr.write(`${t('ceremony.gate_cancelled')}\n`)
  return proceed
}

/**
 * Is there a person on both ends of this?
 *
 * `shouldRenderForHuman` reads stdout, which is the right question for output
 * and the wrong one for a prompt: stdout can be a terminal while stdin is
 * `/dev/null` or a pipe nobody writes to — an agent harness with a pty on the
 * output side is the ordinary case. Asking then either returns an empty answer
 * that reads as a decline and exits zero, or blocks forever. Both are worse than
 * the refusal this gate exists to produce, so tier two needs a terminal on both
 * streams.
 */
function isAttended(human: HumanOutputContext): boolean {
  return shouldRenderForHuman(human) && process.stdin.isTTY === true
}

async function enforceTierTwo(request: WriteGateRequest, attended: boolean): Promise<boolean> {
  const { verdict } = request
  const reason = verdict.reason ?? 'no_where'

  if (!attended) {
    // Same refusal, different sentence, when the caller is a dbcli subcommand
    // the interactive shell spawned: there a person *is* watching, and telling
    // them "nobody is here" or "run it from an interactive terminal" describes
    // neither their situation nor anything they can do. `code` and `reason` are
    // untouched — an agent branches on those, and this changes only the prose.
    const inShell = process.env.DBCLI_SHELL_SUBCOMMAND === '1'
    throw new WriteGateRefusal(
      inShell
        ? `${t_vars('ceremony.gate_refused_in_shell', { reason })} ${t('ceremony.gate_remedy_in_shell')}`
        : `${t_vars('ceremony.gate_refused', { reason })} ${t(REMEDY_KEY[reason])}`,
      reason,
      verdict.table
    )
  }

  writeSummary(request)
  // A warning that interpolates a table it does not have reads as "This destroys
  // ." — the untargeted wording says the same thing without the hole.
  const warning =
    verdict.table === undefined && reason === 'ddl_destruction'
      ? t('ceremony.gate_ddl_warning_untargeted')
      : t_vars(WARNING_KEY[reason], { table: verdict.table ?? '' })
  process.stderr.write(`\n${warning}\n${t(REMEDY_KEY[reason])}\n`)

  const ask = request.ask ?? promptUser.text
  const typed = await ask(
    t_vars('ceremony.gate_typed_prompt', { phrase: verdict.confirmationPhrase })
  )

  // Withdrawn, not answered wrong. Telling somebody who pressed Ctrl-C that
  // what they typed "did not match" describes an answer they never gave.
  if (typed === null) {
    process.stderr.write(`${t('ceremony.gate_cancelled')}\n`)
    return false
  }

  // Compared without case or surrounding space so that a correct answer typed
  // by a person is never rejected for a reason they cannot see. Nothing weaker:
  // a partial match would make the phrase decorative.
  const matched = typed.trim().toLowerCase() === verdict.confirmationPhrase.toLowerCase()
  if (!matched) {
    process.stderr.write(
      `${t_vars('ceremony.gate_typed_mismatch', { phrase: verdict.confirmationPhrase })}\n`
    )
  }
  return matched
}

/** What the tool understood, above the statement itself, so the two can be compared. */
function writeSummary(request: WriteGateRequest): void {
  const { verdict, operation, statement } = request
  const summary = verdict.table
    ? t_vars('ceremony.gate_summary', { operation, table: verdict.table })
    : t_vars('ceremony.gate_summary_untargeted', { operation })

  process.stderr.write(`\n${summary}\n${t('ceremony.gate_statement')}\n  ${statement}\n`)
}

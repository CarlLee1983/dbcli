/**
 * The command layer's answer to "how do we ask before writing?".
 *
 * This is the presentation half of what used to live inside DataExecutor.
 * Core now reports what is about to happen and this decides how it looks, so
 * that stdout — the surface agents parse — is owned entirely by the layer that
 * knows whether a human is watching.
 *
 * It is written to stderr, not stdout. The block used to share a stream with
 * the JSON result envelope, which meant that any mutation nobody forced
 * produced stdout no parser could read: three paragraphs of prose, then the
 * document. A question addressed to a person is not part of the result, so it
 * belongs on the stream this CLI already uses for everything addressed to a
 * person — the same choice `audit clear` made for its own confirmation.
 * A terminal shows both streams, so nothing changes for the human being asked.
 *
 * The wording — including the destructive-delete warning and the question
 * itself, which core used to supply as finished English sentences — is chosen
 * here and read from the message catalogue. Core reports that the operation is
 * irreversible; what a person is told about that is presentation, and only this
 * layer can translate it. The English strings are unchanged, so the move is
 * verifiable rather than merely trusted.
 */

import { t, t_vars } from '@/i18n/message-loader'
import type { MutationConfirmationRequest, MutationConfirmer } from '@/types'
import type { DDLConfirmer } from '@/types/ddl'
import { promptUser } from '@/utils/prompts'

export const confirmMutationInteractively: MutationConfirmer = async (
  request: MutationConfirmationRequest
): Promise<boolean> => {
  if (request.destructive) {
    process.stderr.write(`\n${t('ceremony.confirm_destructive_warning')}\n`)
  }

  const label = request.engine === 'sql' ? 'ceremony.confirm_sql' : 'ceremony.confirm_command'
  process.stderr.write(`\n${t(label)}\n  ${request.sql}\n`)

  // A MongoDB or Redis statement carries its values inline, so the block would
  // read "Parameters: []" — noise directly above the question, on the one
  // surface where noise costs the most.
  if (request.params.length > 0) {
    process.stderr.write(
      `\n${t('ceremony.confirm_params')}\n  ${JSON.stringify(request.params, null, 2)}\n`
    )
  }

  return promptUser.confirm(
    t(request.destructive ? 'ceremony.confirm_destructive_prompt' : 'ceremony.confirm_prompt')
  )
}

/**
 * Ask before a destructive schema change.
 *
 * `DDLExecutor` asked for itself until now, calling `promptUser` from inside
 * `src/core` — the last route by which core could reach a terminal, and one the
 * no-stdout gate could not see because it reads writes rather than imports. The
 * question lives here with the others so that "how dbcli asks" has one answer,
 * and so `migrate` can be embedded by a caller that asks its own way.
 */
export const confirmDdlInteractively: DDLConfirmer = async (request) => {
  process.stderr.write(`\n${t('ceremony.confirm_destructive_warning_ddl')}\n`)
  process.stderr.write(`\n${t('ceremony.confirm_sql')}\n  ${request.sql}\n`)

  return promptUser.confirm(t_vars('ceremony.confirm_ddl_prompt', { operation: request.operation }))
}

/**
 * Ask before a write that never passes through `DataExecutor`.
 *
 * MongoDB and Redis writes are issued straight from the command against the
 * adapter, so the confirmation `DataExecutor` performs for SQL never ran for
 * them: `dbcli delete` against a Mongo collection destroyed documents without
 * asking anybody, whatever the terminal. The gate lives here rather than in
 * each command so that the three engines cannot answer the question
 * differently, and `--force` is honoured in exactly one place.
 *
 * Returns true when the write may proceed.
 */
export async function confirmDirectMutation(request: {
  operation: MutationConfirmationRequest['operation']
  engine: 'mongodb' | 'redis'
  /** The statement, in the same form the dry run would print. */
  preview: string
  destructive: boolean
  force?: boolean
}): Promise<boolean> {
  if (request.force === true) return true

  return confirmMutationInteractively({
    operation: request.operation,
    engine: request.engine,
    sql: request.preview,
    params: [],
    destructive: request.destructive,
  })
}

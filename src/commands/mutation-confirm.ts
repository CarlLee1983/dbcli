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

import { t } from '@/i18n/message-loader'
import type { MutationConfirmationRequest, MutationConfirmer } from '@/types'
import { promptUser } from '@/utils/prompts'

export const confirmMutationInteractively: MutationConfirmer = async (
  request: MutationConfirmationRequest
): Promise<boolean> => {
  if (request.destructive) {
    process.stderr.write(`\n${t('ceremony.confirm_destructive_warning')}\n`)
  }
  process.stderr.write(`\n${t('ceremony.confirm_sql')}\n  ${request.sql}\n`)
  process.stderr.write(
    `\n${t('ceremony.confirm_params')}\n  ${JSON.stringify(request.params, null, 2)}\n`
  )

  return promptUser.confirm(
    t(request.destructive ? 'ceremony.confirm_destructive_prompt' : 'ceremony.confirm_prompt')
  )
}

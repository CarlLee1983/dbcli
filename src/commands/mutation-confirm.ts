/**
 * The command layer's answer to "how do we ask before writing?".
 *
 * This is the presentation half of what used to live inside DataExecutor.
 * Core now reports what is about to happen and this decides how it looks, so
 * that stdout — the surface agents parse — is owned entirely by the layer that
 * knows whether a human is watching.
 *
 * The wording and spacing here are load-bearing for now: they reproduce the
 * pre-refactor output byte for byte, which is what lets the move be verified
 * rather than trusted. Ceremony changes them on purpose, later.
 */

import type { MutationConfirmationRequest, MutationConfirmer } from '@/types'
import { promptUser } from '@/utils/prompts'

export const confirmMutationInteractively: MutationConfirmer = async (
  request: MutationConfirmationRequest
): Promise<boolean> => {
  if (request.warning) {
    console.log(`\n${request.warning}`)
  }
  console.log('\nGenerated SQL:')
  console.log(`  ${request.sql}`)
  console.log('\nParameters:')
  console.log(`  ${JSON.stringify(request.params, null, 2)}`)

  return promptUser.confirm(request.prompt)
}

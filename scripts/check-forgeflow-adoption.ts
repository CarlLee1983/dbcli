/**
 * Gate: this repository gives one answer about which ForgeFlow it adopted.
 *
 * The companion gate `check-forgeflow-handoff.ts` reconciles delivery claims —
 * whether a Story the handoff calls done is backed by the repository. This one
 * reconciles the process version those Stories were written against, which had
 * the same failure in a different place: `specs/.forgeflow-adoption` and
 * `specs/stories/README.md` said 0.3.2 while `specs/handoff.md` still said
 * 0.3.1, across two merged pull requests, and nothing looked.
 *
 * The rules live in `lib/forgeflow-adoption.ts` next to the reasoning for why
 * each is drawn where it is. Everything here is offline by construction: the
 * marker records an upstream revision but nothing fetches it, because a gate
 * that needs the network is a gate that fails for reasons unrelated to the
 * repository it is checking.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectAdoptionDrift,
  formatAdoptionDrift,
  MARKER_PATH,
  README_PATH,
  RESTATEMENT_SURFACES,
} from './lib/forgeflow-adoption'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/** Reads a repository file, reporting absence rather than throwing. */
export const readFromRoot =
  (root: string) =>
  async (path: string): Promise<string | undefined> => {
    const file = Bun.file(join(root, path))
    return (await file.exists()) ? await file.text() : undefined
  }

if (import.meta.main) {
  const drift = await collectAdoptionDrift(readFromRoot(repoRoot))

  if (drift.length > 0) {
    console.error('ForgeFlow adoption reconciliation failed:\n')
    for (const item of drift) console.error(`  ${formatAdoptionDrift(item)}`)
    console.error(
      `\n${drift.length} disagreement(s) about the adopted ForgeFlow release.\n` +
        `${MARKER_PATH} is the source of truth; change it first, then bring every surface to match.`
    )
    process.exit(1)
  }

  console.log(
    `forgeflow adoption reconciliation passed: ${MARKER_PATH} agrees with ` +
      `${README_PATH} and ${RESTATEMENT_SURFACES.length} other surface(s)`
  )
}

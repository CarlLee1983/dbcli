/**
 * Gate: every Story the handoff calls delivered is backed by the repository.
 *
 * The rules live in `lib/forgeflow-handoff.ts` next to the reasoning for why
 * each is drawn where it is. Everything here is the git and filesystem shell
 * around them: gather the evidence, hand it over, print the verdict. Nothing in
 * this file decides anything, which is what lets the decisions be tested
 * against fixtures instead of against a repository whose answers change every
 * time a Story is delivered.
 *
 * The sibling gate `check-forgeflow-adoption.ts` reconciles the process version
 * those Stories were written against. The two are deliberately disjoint: one
 * checks delivery claims, the other checks which ForgeFlow this repository says
 * it adopted.
 */

import { $ } from 'bun'
import {
  collectStoryIds,
  formatFailures,
  parseLifecycle,
  reconcile,
  shallowCloneRefusal,
  type Exemption,
} from './lib/forgeflow-handoff'

const repoRoot = new URL('../', import.meta.url)
const handoffPath = new URL('specs/handoff.md', repoRoot)
const storiesRoot = new URL('specs/stories/', repoRoot)

/**
 * Stories delivered before commits carried `Story:` trailers.
 *
 * Each entry names the commit that delivered it and the evidence that was
 * re-run to confirm it, so the claim travels with its proof rather than with a
 * promise to check later. Only ever remove entries.
 */
const DELIVERED_BEFORE_TRAILERS: ReadonlyMap<string, Exemption> = new Map([
  [
    'DBCLI-001',
    {
      commit: '3a310d08eb0460b1d0334453009d734a2d5c5ecb',
      evidence:
        "tests/unit/commands/skill-context.test.ts 'preserves semantic context when the optional contracts file is absent without creating an adapter' and tests/unit/core/contracts/contracts.test.ts 'reports invalid drift without disclosing arbitrary input or creating an adapter'",
    },
  ],
])

/** Story IDs that have a `Story: <ID>` trailer somewhere in history. */
async function storiesWithTrailers(): Promise<Set<string>> {
  const log = await $`git log --all --format=%b`.text()
  return new Set([...log.matchAll(/^Story:\s*(\S+)\s*$/gm)].map(([, id]) => id as string))
}

async function commitExists(commit: string): Promise<boolean> {
  try {
    await $`git cat-file -e ${`${commit}^{commit}`}`.quiet()
    return true
  } catch {
    return false
  }
}

/** Every Story directory, paired with the text of its `story.md`. */
async function storySources() {
  const entries = await Array.fromAsync(
    new Bun.Glob('*/story.md').scan({ cwd: storiesRoot.pathname })
  )
  return Promise.all(
    entries
      .map((entry) => entry.replace(/[/\\]story\.md$/, ''))
      // `_template/` is a form, not a Story: its heading reads `# Story: <ID>`.
      .filter((directory) => !directory.startsWith('_'))
      .map(async (directory) => ({
        directory,
        source: await Bun.file(new URL(`${directory}/story.md`, storiesRoot)).text(),
      }))
  )
}

const refusal = shallowCloneRefusal(await $`git rev-parse --is-shallow-repository`.text())
if (refusal !== null) {
  console.error(refusal)
  process.exit(1)
}

const lifecycle = parseLifecycle(await Bun.file(handoffPath).text())

const failures = await reconcile({
  lifecycle,
  directories: collectStoryIds(await storySources()),
  trailers: await storiesWithTrailers(),
  exemptions: DELIVERED_BEFORE_TRAILERS,
  commitExists,
})

if (failures.length > 0) {
  console.error(formatFailures(failures))
  process.exit(1)
}

const completed = lifecycle.completedStories.length
const exempt = DELIVERED_BEFORE_TRAILERS.size
console.log(
  `forgeflow handoff reconciliation passed: ${completed} completed Stories ` +
    `(${completed - exempt} by commit trailer, ${exempt} by recorded delivering commit)`
)

/**
 * Gate: this repository satisfies the ForgeFlow contract it says it adopted.
 *
 * The rules live in `lib/forgeflow-contract.ts` next to the reasoning for why
 * each is drawn where it is. Everything here is the subprocess and filesystem
 * shell around them: fetch what upstream says, hand it over, print the verdict.
 *
 * Not a `make verify` step, deliberately. It needs a ForgeFlow checkout, and
 * the canonical gate has to run from a clone of this repository alone. CI runs
 * it as its own job, which is also why the two sibling gates —
 * `check-forgeflow-adoption.ts` and `check-forgeflow-handoff.ts` — stay offline
 * and stay in `make verify`: they check what this repository says about itself,
 * where this one checks it against somebody else's rules.
 */

import { $ } from 'bun'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkoutRefusal,
  formatContractFailures,
  reconcileFindings,
  type Exemptions,
  type StoryResult,
} from './lib/forgeflow-contract'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Findings that predate this gate, exactly as upstream `story-check` states
 * them.
 *
 * All twenty-one failed identically under 0.3.2; the upgrade did not cause one
 * of them. They are three kinds of wording — a trust-boundary field written as
 * prose, a security fixture cell written as prose instead of an exact value in
 * backticks, and one Story whose Classification contradicts its own Superseded
 * Behavior section. Fixing them means re-deriving sixteen matrix cells from the
 * code they describe and editing acceptance text a human already accepted, so
 * it is its own Story rather than a paragraph of this one.
 *
 * A ratchet: entries may be deleted and never added.
 */
const PREDATING_FINDINGS: Exemptions = new Map([
  [
    'DBCLI-PLAT-004-operation-envelope-v1',
    ['every trust-boundary field must name an exact field, not prose'],
  ],
  [
    'DBCLI-PLAT-005-agent-json-mode',
    [
      'every trust-boundary field must name an exact field, not prose',
      'Story declares Baseline conformance: no but declares superseded behavior',
    ],
  ],
  [
    'DBCLI-PLAT-006-correlation-id',
    [
      'security fixture row 1 states verification as prose instead of an exact value',
      'security fixture row 2 states verification as prose instead of an exact value',
      'security fixture row 3 states verification as prose instead of an exact value',
      'security fixture row 4 states verification as prose instead of an exact value',
      'security fixture row 5 states verification as prose instead of an exact value',
      'security fixture row 6 states verification as prose instead of an exact value',
    ],
  ],
  [
    'DBCLI-PLAT-007-bounded-evidence-receipts',
    [
      'security fixture row 1 states source field as prose instead of an exact value',
      'security fixture row 2 states source field as prose instead of an exact value',
      'security fixture row 3 states source field as prose instead of an exact value',
      'security fixture row 4 states source field as prose instead of an exact value',
      'security fixture row 5 states source field as prose instead of an exact value',
      'security fixture row 6 states source field as prose instead of an exact value',
      'security fixture row 7 states source field as prose instead of an exact value',
      'security fixture row 8 states source field as prose instead of an exact value',
      'every trust-boundary field must name an exact field, not prose',
    ],
  ],
  [
    'DBCLI-PLAT-012-schema-cache-write-boundary',
    [
      'security fixture row 10 states source field as prose instead of an exact value',
      'security fixture row 10 states persisted locations as prose instead of an exact value',
      'every trust-boundary field must name an exact field, not prose',
    ],
  ],
])

const adopted = (await Bun.file(join(repoRoot, 'specs/.forgeflow-adoption')).text())
  .split('\n')
  .find((line) => line.startsWith('revision='))
  ?.slice('revision='.length)
  .trim()

if (adopted === undefined) {
  console.error('specs/.forgeflow-adoption records no revision')
  process.exit(1)
}

const forgeflowRoot = process.env.FORGEFLOW_ROOT
const checkout = forgeflowRoot === undefined ? undefined : forgeflowRoot

const revision =
  checkout === undefined
    ? undefined
    : (await $`git -C ${checkout} rev-parse HEAD`.nothrow().quiet()).text().trim() || undefined

const refusal = checkoutRefusal(adopted, revision)
if (refusal !== null) {
  console.error(refusal)
  process.exit(1)
}

const storiesRoot = join(repoRoot, 'specs/stories')
const directories = (await Array.fromAsync(new Bun.Glob('*/story.md').scan({ cwd: storiesRoot })))
  .map((entry) => entry.replace(/[/\\]story\.md$/, ''))
  .filter((directory) => !directory.startsWith('_'))
  .sort()

const results: StoryResult[] = []
for (const directory of directories) {
  const path = join(storiesRoot, directory)
  const checked = await $`${join(checkout as string, 'scripts/story-check')} ${path}`
    .nothrow()
    .quiet()

  const output = `${checked.stdout.toString()}${checked.stderr.toString()}`
  results.push({
    story: directory,
    findings: output
      .split('\n')
      .filter((line) => line.startsWith('FAIL'))
      .map((line) => line.replace(`FAIL  ${path}: `, '').trim()),
  })
}

const failures = reconcileFindings(results, PREDATING_FINDINGS)

// Upstream's own view of the handoff, which the offline sibling gate cannot
// give: it reconciles delivery claims against git, this checks the block's
// shape against the protocol.
const handoff =
  await $`${join(checkout as string, 'scripts/handoff-check')} ${join(repoRoot, 'specs/handoff.md')}`
    .nothrow()
    .quiet()

if (handoff.exitCode !== 0) {
  const output = `${handoff.stdout.toString()}${handoff.stderr.toString()}`
  for (const line of output.split('\n').filter((entry) => entry.startsWith('FAIL'))) {
    failures.push({ subject: 'specs/handoff.md', reason: line.replace(/^FAIL\s+/, '') })
  }
}

if (failures.length > 0) {
  console.error(formatContractFailures(failures))
  process.exit(1)
}

const admitted = [...PREDATING_FINDINGS.values()].reduce((total, list) => total + list.length, 0)
console.log(
  `forgeflow contract check passed against ${adopted.slice(0, 8)}: ` +
    `${directories.length} Stories, ${admitted} admitted pre-existing finding(s), handoff contract OK`
)

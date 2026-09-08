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
  PREDATING_FINDINGS,
  readCheckerRun,
  reconcileFindings,
  type StoryResult,
} from './lib/forgeflow-contract'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

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

/** Refuse rather than continue: an unusable run says nothing about any Story. */
function refuse(reason: string): never {
  console.error(`ForgeFlow contract check cannot run: ${reason}`)
  process.exit(1)
}

// A checkout at the right revision can still be unusable — a partial clone, a
// non-executable script. Bun's `.nothrow()` swallows the spawn failure and
// hands back zero findings for every Story, which reads exactly like a clean
// repository.
const storyCheck = join(checkout as string, 'scripts/story-check')
if (!(await Bun.file(storyCheck).exists())) refuse(`${storyCheck} does not exist`)

const storiesRoot = join(repoRoot, 'specs/stories')
const directories = (await Array.fromAsync(new Bun.Glob('*/story.md').scan({ cwd: storiesRoot })))
  .map((entry) => entry.replace(/[/\\]story\.md$/, ''))
  .filter((directory) => !directory.startsWith('_'))
  .sort()

const results: StoryResult[] = []
for (const directory of directories) {
  const path = join(storiesRoot, directory)
  const checked = await $`${storyCheck} ${path}`.nothrow().quiet()

  const read = readCheckerRun(directory, {
    exitCode: checked.exitCode,
    output: `${checked.stdout.toString()}${checked.stderr.toString()}`,
  })

  if (typeof read === 'string') refuse(read)

  results.push({
    story: directory,
    findings: read.map((line) => line.replace(`FAIL  ${path}: `, '').trim()),
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

const handoffRead = readCheckerRun('specs/handoff.md', {
  exitCode: handoff.exitCode,
  output: `${handoff.stdout.toString()}${handoff.stderr.toString()}`,
})

// A deleted, emptied or unreadable handoff exits non-zero with no FAIL lines —
// the states the handoff contract exists to prevent — and used to be reported
// as "handoff contract OK".
if (typeof handoffRead === 'string') refuse(handoffRead)

for (const line of handoffRead) {
  failures.push({ subject: 'specs/handoff.md', reason: line.replace(/^FAIL\s+/, '') })
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

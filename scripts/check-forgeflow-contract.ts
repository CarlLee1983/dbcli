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
  parseStoryCheck,
  readCheckerRun,
  reconcileFindings,
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

/** Ask git a question of the checkout, or report that it could not answer. */
async function ask(root: string, ...argv: string[]): Promise<string | undefined> {
  const answered = await $`git -C ${root} ${argv}`.nothrow().quiet()
  return answered.exitCode === 0 ? answered.text() : undefined
}

const refusal = checkoutRefusal(adopted, {
  root: forgeflowRoot,
  revision:
    forgeflowRoot === undefined
      ? undefined
      : (await ask(forgeflowRoot, 'rev-parse', 'HEAD'))?.trim(),
  status:
    forgeflowRoot === undefined ? undefined : await ask(forgeflowRoot, 'status', '--porcelain'),
})

if (refusal !== null) {
  console.error(refusal)
  process.exit(1)
}

/** Refuse rather than continue: an unusable run says nothing about any Story. */
function refuse(reason: string): never {
  console.error(`ForgeFlow contract check cannot run: ${reason}`)
  process.exit(1)
}

const checkout = forgeflowRoot as string
const storyCheck = join(checkout, 'scripts/story-check')
if (!(await Bun.file(storyCheck).exists())) refuse(`${storyCheck} does not exist`)

// One run, with no arguments, from the repository root: upstream discovers the
// Story directories itself. Globbing for them here was directory selection
// reimplemented, and it hid a directory holding an `acceptance.md` and no
// `story.md` — upstream ERRORs on that; the glob simply did not see it.
// `FORGEFLOW_DECISIONS_ROOT` is set here rather than left to the caller. Upstream
// resolves `Decision:` against `specs/decisions/` by default (ForgeFlowV2 issue
// #23, fixed in 0.7.0); this repository keeps its records in `docs/adr/`, and a
// variable a human has to remember is a check that passes locally and fails in CI,
// or worse the other way round. ADR-0029.
const checked = await $`${storyCheck}`
  .cwd(repoRoot)
  .env({ ...process.env, FORGEFLOW_DECISIONS_ROOT: join(repoRoot, 'docs/adr') })
  .nothrow()
  .quiet()
const read = readCheckerRun('specs/stories', {
  exitCode: checked.exitCode,
  output: `${checked.stdout.toString()}${checked.stderr.toString()}`,
})

if (typeof read === 'string') refuse(read)

const results = parseStoryCheck(`${checked.stdout.toString()}${checked.stderr.toString()}`)

const failures = reconcileFindings(results, PREDATING_FINDINGS)

// Upstream's own view of the handoff, which the offline sibling gate cannot
// give: it reconciles delivery claims against git, this checks the block's
// shape against the protocol.
const handoff =
  await $`${join(checkout, 'scripts/handoff-check')} ${join(repoRoot, 'specs/handoff.md')}`
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
    `${results.length} Stories, ${admitted} admitted pre-existing finding(s), handoff contract OK`
)

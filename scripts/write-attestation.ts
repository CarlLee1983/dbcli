/**
 * Write the Verification Attestation for a `make verify` run.
 *
 * Two phases, because the two facts are true at different times. `begin`
 * resolves the revision and the worktree's cleanliness before the first step
 * runs — resolving them afterwards would describe whatever the steps left
 * behind. `finish` takes the run's exit status and writes the document.
 *
 * The rules live in `lib/verification-attestation.ts`. Everything here is the
 * git and filesystem shell around them, so the format stays testable from
 * fixtures rather than from a repository whose HEAD moves every delivery.
 *
 * Nothing here decides whether the verification passed. It records the status
 * it was handed and gets out of the way: the Makefile re-exits with that same
 * status, so a failure to write an attestation can never turn a FAIL into a
 * PASS.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import {
  buildAttestation,
  readEnvironment,
  serialiseAttestation,
} from './lib/verification-attestation'

const REPOSITORY = 'CarlLee1983/dbcli'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = join(repoRoot, '.verification')
const attestationPath = join(outputDirectory, 'attestation.json')

const instant = () => new Date().toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z')

const environment = () =>
  readEnvironment({
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
  })

/**
 * Print what the run started as, for `finish` to be handed back.
 *
 * Through the recipe's own shell rather than a file on purpose. A `run.json`
 * left behind by a killed run would be picked up by the next `finish` and
 * produce one document describing two runs — a revision from one and a result
 * from another, with nothing in the file admitting it. Passing the values along
 * the one shell that owns both phases makes that impossible rather than
 * unlikely.
 *
 * A repository that cannot answer is refused rather than recorded as unknown:
 * an attestation whose revision is a guess attests nothing, and it would be
 * believed anyway.
 */
async function begin(): Promise<void> {
  const resolved = await $`git rev-parse HEAD`.cwd(repoRoot).nothrow().quiet()
  if (resolved.exitCode !== 0) {
    throw new Error(
      'git rev-parse HEAD failed, so there is no revision to attest — ' +
        'a verification outside a repository produces no attestation'
    )
  }

  const status = await $`git status --porcelain`.cwd(repoRoot).nothrow().quiet()
  if (status.exitCode !== 0) throw new Error('git status --porcelain failed')

  // Any attestation still lying here belongs to an earlier run. Left in place,
  // a run killed before `finish` — a CI timeout, a cancelled job — would let
  // `if: always()` publish the previous run's verdict as this one's. No file is
  // the honest answer to "was this revision verified"; a stale file is not.
  await rm(attestationPath, { force: true })

  const worktree = status.text().trim().length > 0 ? 'dirty' : 'clean'
  console.log(`${resolved.text().trim()} ${worktree} ${instant()}`)
}

async function finish(
  exitCode: number,
  revision: string | undefined,
  worktree: string | undefined,
  startedAt: string | undefined
): Promise<void> {
  if (revision === undefined || worktree === undefined || startedAt === undefined) {
    throw new Error(
      'finish was not given what begin resolved, so this run has no revision to attest — ' +
        'the verification result stands and no attestation is written'
    )
  }
  if (worktree !== 'clean' && worktree !== 'dirty') {
    throw new Error(`worktree state must be clean or dirty, got ${JSON.stringify(worktree)}`)
  }

  const attestation = buildAttestation({
    repository: REPOSITORY,
    revision,
    dirtyWorktree: worktree === 'dirty',
    command: 'make verify',
    exitCode,
    startedAt,
    finishedAt: instant(),
    environment: environment(),
  })

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(attestationPath, serialiseAttestation(attestation), 'utf8')
  console.log(
    `verification attestation: ${attestation.result} at ${attestation.revision} ` +
      `(${attestation.attestation_hash})`
  )
}

const [phase, ...rest] = process.argv.slice(2)

try {
  if (phase === 'begin') {
    await begin()
  } else if (phase === 'finish') {
    const [status, revision, worktree, startedAt] = rest
    const exitCode = Number.parseInt(status ?? '', 10)
    if (!Number.isInteger(exitCode)) {
      throw new Error(`finish needs the run's exit status, got ${JSON.stringify(status)}`)
    }
    await finish(exitCode, revision, worktree, startedAt)
  } else {
    throw new Error(
      `unknown phase ${JSON.stringify(phase)}; expected 'begin' or 'finish <status> <revision> <clean|dirty> <started-at>'`
    )
  }
} catch (cause) {
  // The verification's own result is authoritative, in both directions. This
  // failure is reported and nothing else: the recipe neither stops for it nor
  // re-exits with it, so a broken attestation costs a record, never a verdict.
  console.error(`Failed to write verification attestation: ${(cause as Error).message}`)
  process.exitCode = 1
}

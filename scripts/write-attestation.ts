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

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import {
  buildAttestation,
  serialiseAttestation,
  type AttestationEnvironment,
} from './lib/verification-attestation'

const REPOSITORY = 'CarlLee1983/dbcli'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = join(repoRoot, '.verification')
const runPath = join(outputDirectory, 'run.json')
const attestationPath = join(outputDirectory, 'attestation.json')

/** What `begin` recorded, for `finish` to complete. */
interface Run {
  readonly repository: string
  readonly revision: string
  readonly dirtyWorktree: boolean
  readonly startedAt: string
}

const instant = () => new Date().toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z')

const environment = (): AttestationEnvironment => ({
  os: process.platform,
  arch: process.arch,
  bun: Bun.version,
  // Presence only. Copying the value would be harmless CI output today and an
  // arbitrary caller-supplied string tomorrow.
  ci: process.env.CI !== undefined,
})

/**
 * Resolve the commit under verification.
 *
 * A repository that cannot answer is refused rather than recorded as unknown:
 * an attestation whose revision is a guess attests nothing, and it would be
 * believed anyway.
 */
async function resolveRun(): Promise<Run> {
  const resolved = await $`git rev-parse HEAD`.cwd(repoRoot).nothrow().quiet()
  if (resolved.exitCode !== 0) {
    throw new Error(
      'git rev-parse HEAD failed, so there is no revision to attest — ' +
        'a verification outside a repository produces no attestation'
    )
  }

  const status = await $`git status --porcelain`.cwd(repoRoot).nothrow().quiet()
  if (status.exitCode !== 0) throw new Error('git status --porcelain failed')

  return {
    repository: REPOSITORY,
    revision: resolved.text().trim(),
    dirtyWorktree: status.text().trim().length > 0,
    startedAt: instant(),
  }
}

async function begin(): Promise<void> {
  const run = await resolveRun()
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8')
}

async function finish(exitCode: number): Promise<void> {
  const run = JSON.parse(await readFile(runPath, 'utf8')) as Run

  const attestation = buildAttestation({
    ...run,
    command: 'make verify',
    exitCode,
    finishedAt: instant(),
    environment: environment(),
  })

  await writeFile(attestationPath, serialiseAttestation(attestation), 'utf8')
  console.log(
    `verification attestation: ${attestation.result} at ${attestation.revision} ` +
      `(${attestation.attestation_hash})`
  )
}

const [phase, status] = process.argv.slice(2)

try {
  if (phase === 'begin') {
    await begin()
  } else if (phase === 'finish') {
    const exitCode = Number.parseInt(status ?? '', 10)
    if (!Number.isInteger(exitCode)) {
      throw new Error(`finish needs the run's exit status, got ${JSON.stringify(status)}`)
    }
    await finish(exitCode)
  } else {
    throw new Error(`unknown phase ${JSON.stringify(phase)}; expected 'begin' or 'finish <status>'`)
  }
} catch (cause) {
  // The verification's own result is authoritative. This failure is reported and
  // the Makefile re-exits with the status it captured, so a broken attestation
  // costs a record, never a verdict.
  console.error(`Failed to write verification attestation: ${(cause as Error).message}`)
  process.exitCode = 1
}

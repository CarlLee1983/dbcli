import { expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineFeature } from './support/feature-runner'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const EXPIRED_ARTIFACT_ID = 'expired-artifact'

type CommandResult = { stdout: string; stderr: string; code: number }
type PruneReport = { candidates: Array<{ id: string }>; deleted: string[]; dryRun: boolean }
type ListReport = { artifacts: Array<{ id: string }> }
type PruneWorld = {
  workspace?: string
  result?: CommandResult
  report?: PruneReport
}

await defineFeature<PruneWorld>({
  featurePath: join(import.meta.dir, 'prune-verification.feature'),
  createWorld: () => ({}),
  afterScenario: async (world) => {
    if (world.workspace) {
      await rm(world.workspace, { recursive: true, force: true })
    }
  },
  steps: [
    {
      pattern: /^a workspace with an expired verification artifact$/,
      run: async (world) => {
        const workspace = await mkdtemp(join(tmpdir(), 'dbcli-gherkin-prune-'))
        world.workspace = workspace

        const directory = join(workspace, '.dbcli', 'verification')
        await mkdir(directory, { recursive: true })
        const createdAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
        const stamp = createdAt.replace(/[-:T.Z]/g, '').slice(0, 14)
        await writeFile(
          join(
            directory,
            `verification-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${EXPIRED_ARTIFACT_ID}.json`
          ),
          JSON.stringify({
            schemaVersion: 1,
            id: EXPIRED_ARTIFACT_ID,
            createdAt,
            status: 'verified',
            subject: { kind: 'backfill', name: 'safe-backfill-verify' },
            summary: 'Verification completed.',
            evidence: [{ kind: 'assert', exitCode: 0 }],
          })
        )
      },
    },
    {
      pattern: /^I preview pruning artifacts older than 30 days$/,
      run: async (world) => {
        if (!world.workspace) throw new Error('The workspace was not configured')
        world.result = await runCli(world.workspace, [
          'verification',
          'prune',
          '--older-than',
          '30d',
          '--keep-latest',
          '0',
          '--format',
          'json',
        ])
        world.report = JSON.parse(world.result.stdout) as PruneReport
      },
    },
    {
      pattern: /^the command succeeds$/,
      run: (world) => {
        expect(world.result?.code).toBe(0)
        expect(world.result?.stderr).toBe('')
        expect(world.report?.dryRun).toBe(true)
      },
    },
    {
      pattern: /^the expired artifact is a prune candidate$/,
      run: (world) =>
        expect(world.report?.candidates.map((candidate) => candidate.id)).toEqual([
          EXPIRED_ARTIFACT_ID,
        ]),
    },
    {
      pattern: /^no verification artifacts are deleted$/,
      run: (world) => expect(world.report?.deleted).toEqual([]),
    },
    {
      pattern: /^the expired artifact is still listed$/,
      run: async (world) => {
        if (!world.workspace) throw new Error('The workspace was not configured')
        const result = await runCli(world.workspace, ['verification', 'list', '--format', 'json'])
        expect(result.code).toBe(0)
        expect(
          (JSON.parse(result.stdout) as ListReport).artifacts.map((artifact) => artifact.id)
        ).toContain(EXPIRED_ARTIFACT_ID)
      },
    },
  ],
})

async function runCli(workspace: string, args: string[]): Promise<CommandResult> {
  const processHandle = Bun.spawn({
    cmd: ['bun', 'run', CLI, ...args],
    cwd: workspace,
    env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1', NODE_ENV: 'test' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ])
  return { stdout, stderr, code }
}

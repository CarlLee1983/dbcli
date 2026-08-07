import { expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineFeature } from './support/feature-runner'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

type CommandResult = { stdout: string; stderr: string; code: number }
type BlacklistReport = { tables: string[]; columns: Record<string, string[]>; warnings: string[] }
type BlacklistWorld = {
  workspace?: string
  configPath?: string
  result?: CommandResult
  report?: BlacklistReport
}

await defineFeature<BlacklistWorld>({
  featurePath: join(import.meta.dir, 'review-blacklist.feature'),
  createWorld: () => ({}),
  afterScenario: async (world) => {
    if (world.workspace) {
      await rm(world.workspace, { recursive: true, force: true })
    }
  },
  steps: [
    {
      pattern: /^a workspace with configured protected data$/,
      run: async (world) => {
        const workspace = await mkdtemp(join(tmpdir(), 'dbcli-gherkin-blacklist-'))
        world.workspace = workspace
        world.configPath = join(workspace, '.dbcli')
        await Bun.write(
          world.configPath,
          JSON.stringify({
            connection: {
              system: 'postgresql',
              host: 'localhost',
              port: 5432,
              user: 'test',
              password: 'test',
              database: 'testdb',
            },
            permission: 'query-only',
            blacklist: { tables: ['audit_logs'], columns: { users: ['password'] } },
          })
        )
      },
    },
    {
      pattern: /^I list the blacklist as JSON$/,
      run: async (world) => {
        if (!world.workspace || !world.configPath)
          throw new Error('The workspace was not configured')
        world.result = await runCli(world.workspace, [
          'blacklist',
          'list',
          '--config',
          world.configPath,
          '--format',
          'json',
        ])
        world.report = JSON.parse(world.result.stdout) as BlacklistReport
      },
    },
    {
      pattern: /^the command succeeds$/,
      run: (world) => {
        expect(world.result?.code).toBe(0)
        expect(world.result?.stderr).toBe('')
      },
    },
    {
      pattern: /^the protected tables are "([^"]+)"$/,
      run: (world, match) => expect(world.report?.tables).toEqual([match[1]]),
    },
    {
      pattern: /^the protected columns for "([^"]+)" are "([^"]+)"$/,
      run: (world, match) => expect(world.report?.columns[match[1]]).toEqual([match[2]]),
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

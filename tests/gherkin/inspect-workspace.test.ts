import { expect } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineFeature } from './support/feature-runner'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const FIXTURE_SOURCE = resolve(import.meta.dir, '../fixtures/inspect/v1-postgres')

type CommandResult = { stdout: string; stderr: string; code: number }
type InspectReport = {
  schemaVersion: number
  system: string | null
  connection: { name: string | null; database: string | null; version: string | null }
  objects: { unavailable?: boolean; reason?: string }
  schemaCache: { available: boolean }
  suggestedCommands: string[]
  warnings: string[]
}
type InspectWorld = {
  workspace?: string
  result?: CommandResult
  report?: InspectReport
}

await defineFeature<InspectWorld>({
  featurePath: join(import.meta.dir, 'inspect-workspace.feature'),
  createWorld: () => ({}),
  afterScenario: async (world) => {
    if (world.workspace) {
      await rm(world.workspace, { recursive: true, force: true })
    }
  },
  steps: [
    {
      pattern: /^a configured PostgreSQL workspace$/,
      run: async (world) => {
        const workspace = await mkdtemp(join(tmpdir(), 'dbcli-gherkin-inspect-'))
        world.workspace = workspace
        await cp(FIXTURE_SOURCE, workspace, { recursive: true })

        const indexPath = join(workspace, '.dbcli', 'schemas', 'index.json')
        const index = JSON.parse(await readFile(indexPath, 'utf8'))
        index.metadata.lastRefreshed = new Date().toISOString()
        await writeFile(indexPath, JSON.stringify(index, null, 2))
      },
    },
    {
      pattern: /^an unconfigured workspace$/,
      run: async (world) => {
        world.workspace = await mkdtemp(join(tmpdir(), 'dbcli-gherkin-empty-'))
      },
    },
    {
      pattern: /^I inspect the workspace without connecting in JSON$/,
      run: async (world) => {
        if (!world.workspace) throw new Error('The workspace was not configured')
        world.result = await runCli(world.workspace, [
          'inspect',
          '--format',
          'json',
          '--no-connect',
        ])
        world.report = JSON.parse(world.result.stdout) as InspectReport
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
      pattern: /^the report schema version is (\d+)$/,
      run: (world, match) => expect(world.report?.schemaVersion).toBe(Number(match[1])),
    },
    {
      pattern: /^the report database system is "([^"]+)"$/,
      run: (world, match) => expect(world.report?.system).toBe(match[1]),
    },
    {
      pattern: /^the database probe is skipped$/,
      run: (world) => {
        expect(world.report?.connection.version).toBeNull()
        expect(world.report?.objects).toMatchObject({
          unavailable: true,
          reason: 'no-connect mode',
        })
        expect(world.report?.warnings.some((warning) => /^(connect|probe):/.test(warning))).toBe(
          false
        )
      },
    },
    {
      pattern: /^the schema cache is available$/,
      run: (world) => expect(world.report?.schemaCache.available).toBe(true),
    },
    {
      pattern: /^the report has no database system$/,
      run: (world) => expect(world.report?.system).toBeNull(),
    },
    {
      pattern: /^the report recommends "([^"]+)"$/,
      run: (world, match) => expect(world.report?.suggestedCommands).toContain(match[1]),
    },
    {
      pattern: /^the report does not expose connection credentials$/,
      run: (world) => {
        expect(world.report?.connection).toEqual({
          name: 'default',
          database: 'fixture_app',
          version: null,
        })
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

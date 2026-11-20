/**
 * `query` / `q` `--format json` must stay byte-for-byte what it was before
 * `--agent-output` covered them (ADR-0024: existing JSON is not reshaped).
 * Fixtures were captured from the pre-change code; only `executionTimeMs`
 * (wall clock) is normalized.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { createWorkspace, connectionFor, execDirect, runCli } from './agent-output-cli'
import { isDbReachable, PG_HOST, PG_PORT } from './helpers'

const SKIP = !(await isDbReachable(PG_HOST, PG_PORT))
const TABLE = 'dbcli_agent_out_baseline'

const baseline = (await Bun.file(
  resolve(import.meta.dir, '../fixtures/agent-output-query/format-json-baseline.json')
).json()) as {
  cases: Record<string, { args: string[]; stdout: string; stderr: string; exitCode: number }>
}

describe.skipIf(SKIP)('--format json output is unchanged for query and q', () => {
  let workspace: ReturnType<typeof createWorkspace>
  let dataAdmin: ReturnType<typeof createWorkspace>

  beforeAll(async () => {
    await execDirect('postgresql', `DROP TABLE IF EXISTS ${TABLE}`)
    await execDirect('postgresql', `CREATE TABLE ${TABLE} (id int primary key, v int)`)
    await execDirect('postgresql', `INSERT INTO ${TABLE} VALUES (1, 1)`)
    dataAdmin = createWorkspace({
      connection: connectionFor('postgresql'),
      permission: 'data-admin',
    })
    workspace = createWorkspace({
      connection: connectionFor('postgresql'),
      permission: 'admin',
      queries: {
        one: `-- ---\n-- name: one\n-- engine: postgres\n-- params:\n--   v:\n--     type: int\n--     default: 1\n-- ---\nSELECT :v AS x;`,
      },
    })
  })

  afterAll(async () => {
    workspace?.dispose()
    dataAdmin?.dispose()
    await execDirect('postgresql', `DROP TABLE IF EXISTS ${TABLE}`)
  })

  for (const name of ['read', 'write', 'savedQuery', 'writeGateRefusal']) {
    test(`${name} matches the captured bytes`, async () => {
      const expected = baseline.cases[name]!
      const result = await runCli(
        expected.args,
        name === 'writeGateRefusal' ? dataAdmin.dir : workspace.dir
      )
      expect({
        stdout: result.stdout.replace(/"executionTimeMs": \d+/, '"executionTimeMs": 0'),
        stderr: result.stderr,
        exitCode: result.code,
      }).toEqual({ stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.exitCode })
    })
  }
})

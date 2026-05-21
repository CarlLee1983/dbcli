import { test, expect, mock } from 'bun:test'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('runShell dispatches an Elasticsearch connection to runEsShell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbcli-es-'))
  const cfg = join(dir, '.dbcli')
  writeFileSync(
    cfg,
    JSON.stringify({
      connection: { system: 'elasticsearch', host: 'localhost', port: 9200, database: 'es' },
      permission: 'query-only',
    })
  )
  let called = ''
  mock.module('@/commands/es-shell', () => ({
    runEsShell: async (p: string) => {
      called = p
    },
  }))
  const { runShell } = await import('@/commands/shell')
  await runShell({}, cfg)
  expect(called).toBe(cfg)
})

import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectionError } from '@/adapters/types'
import { classifyError } from '@/core/recovery/classify'
import { verifyForCode } from '@/core/recovery/verify-steps'
import { renderJson } from '@/core/recovery/render-json'
import { renderMarkdown } from '@/core/recovery/render-markdown'
import { parseSavedRecoveryEnvelope } from '@/core/recovery/envelope-schema'
import { writeLastEnvelope, readLastEnvelopeRaw } from '@/core/recovery/last-envelope'
import { runApply, __setExecutorForTests, __resetExecutorForTests } from '@/core/recovery/apply'
import { isTransportFailure, presentConnectionError } from '@/utils/connection-error-message'

const denied = () =>
  new ConnectionError('DB_PERMISSION_DENIED', 'private-user private-password private-table', [])
const envelope = () =>
  classifyError(denied(), {
    operation: 'query',
    system: 'mysql',
    connectionName: 'private-connection',
    table: 'private-table',
    writeOperation: 'UPDATE',
  })
afterEach(__resetExecutorForTests)

test('native authorization is nontransport and keeps the public discriminator', () => {
  expect(isTransportFailure(denied())).toBe(false)
  expect(presentConnectionError(denied()).code).toBe('DB_PERMISSION_DENIED')
  for (const code of ['42501', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR']) {
    expect(isTransportFailure({ code })).toBe(false)
  }
})

test('native authorization offers manual guidance without executable repair or false verification', () => {
  const env = envelope()
  expect(env.schemaVersion).toBe(1)
  expect(env.error.code).toBe('PERMISSION_DENIED')
  expect(env.error.category).toBe('permission')
  expect(env.error.details).toEqual({ connectionCode: 'DB_PERMISSION_DENIED' })
  expect(env.error.message).toMatch(/administrator/)
  expect(env.error.message).toMatch(/original command/)
  expect(env.recovery).toEqual([])
  expect('verify' in env).toBe(false)
  expect('branches' in env).toBe(false)
  expect('branchFork' in env).toBe(false)
  expect(
    verifyForCode('PERMISSION_DENIED', {
      operation: 'query',
      connectionCode: 'DB_PERMISSION_DENIED',
    })
  ).toBeNull()
  for (const text of [renderJson(env), renderJson(env, { brief: true }), renderMarkdown(env)]) {
    expect(text).toContain('DB_PERMISSION_DENIED')
    expect(text).not.toMatch(/private-|init|password|canWrite|canDestruct/)
    expect(text).not.toContain('"verify"')
  }
})

test('applying native authorization performs no commands and never reports repaired', async () => {
  __setExecutorForTests(async () => {
    throw new Error('must not execute any command')
  })
  const result = await runApply(
    {
      cwd: tmpdir(),
      source: { kind: 'auto', path: '.dbcli/last-recovery.json' },
      envelope: envelope(),
    },
    { allowWrite: 'none' }
  )
  expect(result.results).toEqual([])
  expect(result.finalStatus).toBe('skipped-only')
  expect(result.verifyStatus).toBeUndefined()
})

test('v1 envelopes round-trip both existing authentication and new native authorization', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dbcli-native-recovery-'))
  try {
    for (const env of [
      classifyError(new ConnectionError('AUTH_FAILED', 'private-password', []), {
        operation: 'query',
      }),
      envelope(),
    ]) {
      await writeLastEnvelope(cwd, env, ['dbcli', 'query'])
      const parsed = parseSavedRecoveryEnvelope(await readLastEnvelopeRaw(cwd))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok || !parsed.value) throw new Error(parsed.reason)
      expect(parsed.value.envelope).toEqual(env)
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

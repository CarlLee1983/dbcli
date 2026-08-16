import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeDbcliConfig } from '@/core/config'
import { buildEvidenceReceiptContext } from '@/commands/evidence-receipt-context'
import { makeTestConfig } from '../../helpers/test-config'

function config(schema: Record<string, unknown>): RuntimeDbcliConfig {
  return {
    ...makeTestConfig({
      connection: { user: 'postgres', database: 'dbcli' },
      blacklist: { tables: ['private_accounts'], columns: { orders: ['secret'] } },
      schema,
    }),
    effectiveConnectionName: 'staging',
    effectiveEnvironment: 'staging',
  }
}

describe('evidence receipt context', () => {
  test('hashes only the filtered schema and is stable across object insertion order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-receipt-context-'))
    try {
      const visible = {
        name: 'orders',
        columns: [
          { name: 'id', type: 'int' },
          { name: 'secret', type: 'text' },
        ],
      }
      const privateTable = { name: 'private_accounts', columns: [{ name: 'token', type: 'text' }] }
      const left = await buildEvidenceReceiptContext(
        config({ orders: visible, private_accounts: privateTable }),
        root
      )
      const right = await buildEvidenceReceiptContext(
        config({ private_accounts: privateTable, orders: visible }),
        root
      )
      const withoutProtected = await buildEvidenceReceiptContext(config({ orders: visible }), root)
      expect(left.schemaFingerprint).toBe(right.schemaFingerprint)
      expect(left.schemaFingerprint).toBe(withoutProtected.schemaFingerprint)
      expect(left.semanticFingerprint).toBeNull()
      expect(left).toMatchObject({
        engine: 'postgresql',
        connectionName: 'staging',
        environment: 'staging',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

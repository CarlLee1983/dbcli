import { describe, expect, test } from 'bun:test'
import { executeQueryCommand } from '@/commands/query'
import type { DbcliConfig } from '@/utils/validation'

const config: DbcliConfig = {
  connection: {
    system: 'postgresql',
    host: 'localhost',
    port: 5432,
    user: 'test',
    password: 'test',
    database: 'test',
  },
  permission: 'query-only',
  schema: {},
  metadata: { version: '1.0' },
  blacklist: { tables: [], columns: {} },
}

const execution = {
  result: {
    rows: [{ id: 1 }],
    rowCount: 1,
    columnNames: ['id'],
    metadata: { statement: 'SELECT' },
  },
  diagnostics: [],
  notices: [],
}

describe('executeQueryCommand runtime seam', () => {
  test('orchestrates a single connection without global spies', async () => {
    const calls: string[] = []

    await executeQueryCommand('SELECT 1', { format: 'json' }, undefined, {
      loadConfig: async (configPath, connectionName) => {
        calls.push(`load:${configPath}:${connectionName ?? 'default'}`)
        return config
      },
      preflight: async (_query, _options, context, _fields, multiConnection) => {
        calls.push(`preflight:${context.config.connection?.system}:${multiConnection}`)
      },
      executeConnection: async () => {
        calls.push('execute')
        return execution
      },
      presentResult: async (_query, _options, result, tableCellLimit) => {
        calls.push(`present:${result.result.rowCount}:${tableCellLimit}`)
      },
    })

    expect(calls).toEqual([
      'load:.dbcli:default',
      'preflight:postgresql:false',
      'execute',
      'present:1:120',
    ])
  })

  test('links recovery envelopes to the single failure audit entry', async () => {
    const failure = new Error('connection failed')
    const auditCalls: Array<{ success: boolean; recoveryRef?: string }> = []
    const recoveryCalls: Array<{ table?: string; envelopeId: string; auditRef?: string }> = []

    await expect(
      executeQueryCommand('SELECT * FROM users', { recovery: true }, undefined, {
        loadConfig: async () => config,
        preflight: async () => {},
        executeConnection: async () => {
          throw failure
        },
        presentResult: async () => {},
        writeAudit: async (_config, _command, _options, outcome) => {
          auditCalls.push({ success: outcome.success, recoveryRef: outcome.recovery_ref })
          return 'audit-123'
        },
        randomUUID: () => 'envelope-456',
        extractTableName: async () => 'users',
        emitRecovery: async (_error, context, options) => {
          recoveryCalls.push({
            table: context.table,
            envelopeId: options.envelopeId,
            auditRef: options.auditRef,
          })
        },
      })
    ).rejects.toThrow('connection failed')

    expect(auditCalls).toEqual([{ success: false, recoveryRef: 'envelope-456' }])
    expect(recoveryCalls).toEqual([
      { table: 'users', envelopeId: 'envelope-456', auditRef: 'audit-123' },
    ])
  })
})

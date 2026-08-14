/**
 * Characterisation of what each permission level permits through DataExecutor.
 *
 * DataExecutor reached the permission axis two different ways: executeInsert and
 * executeUpdate called enforcePermission with a synthetic statement, while
 * executeDelete compared this.permission by hand. Unifying them is only safe if
 * the verdicts are known first, so this pins every level against every
 * operation — allow or refuse, and the exact message on refusal — before the
 * implementation moves.
 *
 * These are verdicts, not wording preferences. When a message changes on
 * purpose the diff here is the record of it.
 */

import { describe, test, expect, mock } from 'bun:test'
import { DataExecutor } from '@/core/data-executor'
import type { Permission } from '@/types'

const schema = {
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'amount', type: 'integer', nullable: false, primaryKey: false },
  ],
  rowCount: 0,
  primaryKey: 'id',
  foreignKeys: [],
}

function executorFor(permission: Permission) {
  const adapter = {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    execute: mock(async () => ({ affectedRows: 1, rows: [] })),
    getTableSchema: mock(async () => schema),
    listTables: mock(async () => []),
    ping: mock(async () => {}),
  }
  return new DataExecutor(adapter as any, permission, 'postgresql')
}

const PERMISSIONS: Permission[] = ['query-only', 'read-write', 'data-admin', 'admin']

/** force skips confirmation; permission is decided long before that point. */
const FORCED = { force: true }

async function verdictFor(
  permission: Permission,
  operation: 'insert' | 'update' | 'delete'
): Promise<string> {
  const executor = executorFor(permission)
  const result =
    operation === 'insert'
      ? await executor.executeInsert('users', { amount: 1 }, schema as any, FORCED)
      : operation === 'update'
        ? await executor.executeUpdate('users', { amount: 1 }, { id: 1 }, schema as any, FORCED)
        : await executor.executeDelete('users', { id: 1 }, schema as any, FORCED)

  return result.status === 'success' ? 'allowed' : `refused: ${result.error}`
}

describe('DataExecutor permission verdicts', () => {
  test.each(PERMISSIONS)('insert under %s', async (permission) => {
    expect(await verdictFor(permission, 'insert')).toMatchSnapshot()
  })

  test.each(PERMISSIONS)('update under %s', async (permission) => {
    expect(await verdictFor(permission, 'update')).toMatchSnapshot()
  })

  test.each(PERMISSIONS)('delete under %s', async (permission) => {
    expect(await verdictFor(permission, 'delete')).toMatchSnapshot()
  })

  test('allow/refuse matrix', async () => {
    const matrix: Record<string, string> = {}
    for (const permission of PERMISSIONS) {
      for (const operation of ['insert', 'update', 'delete'] as const) {
        const verdict = await verdictFor(permission, operation)
        matrix[`${permission}/${operation}`] = verdict.startsWith('allowed') ? 'allow' : 'refuse'
      }
    }

    expect(matrix).toEqual({
      'query-only/insert': 'refuse',
      'query-only/update': 'refuse',
      'query-only/delete': 'refuse',
      'read-write/insert': 'allow',
      'read-write/update': 'allow',
      'read-write/delete': 'refuse',
      'data-admin/insert': 'allow',
      'data-admin/update': 'allow',
      'data-admin/delete': 'allow',
      'admin/insert': 'allow',
      'admin/update': 'allow',
      'admin/delete': 'allow',
    })
  })
})

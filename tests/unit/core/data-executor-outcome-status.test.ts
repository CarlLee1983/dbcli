/**
 * Three things that are not the same thing.
 *
 * A cancelled mutation, a dry run, and a write that matched no rows all used to
 * come back as `status: 'success'` with `rows_affected: 0`, indistinguishable to
 * every caller — including the audit log, which recorded a cancellation as a
 * successful write.
 *
 * What these can prove about the database is that no statement is issued. They
 * cannot say the database is never contacted at all: the commands connect and
 * read the table schema before the executor is asked anything, because the SQL
 * a dry run exists to show cannot be built without the column list. That wider
 * boundary is asserted where it actually lives, in
 * `tests/unit/commands/mutation-db-contact.test.ts`.
 */

import { describe, test, expect, mock } from 'bun:test'
import { DataExecutor } from '@/core/data-executor'

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

function executorFor(affectedRows = 3) {
  const execute = mock(async () => ({ affectedRows, rows: [] }))
  const adapter = {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    execute,
    getTableSchema: mock(async () => schema),
    listTables: mock(async () => []),
    ping: mock(async () => {}),
  }
  return { executor: new DataExecutor(adapter as any, 'admin', 'postgresql'), execute }
}

const update = (executor: DataExecutor, options: Record<string, unknown>) =>
  executor.executeUpdate('users', { amount: 1 }, { id: 1 }, schema as any, options as any)

describe('mutation outcome status', () => {
  test('a confirmed write reports success and the rows it touched', async () => {
    const { executor, execute } = executorFor(3)
    const result = await update(executor, { confirm: async () => true })

    expect(result.status).toBe('success')
    expect(result.rows_affected).toBe(3)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('a cancelled write reports cancelled and never issues the statement', async () => {
    const { executor, execute } = executorFor()
    const result = await update(executor, { confirm: async () => false })

    expect(result.status).toBe('cancelled')
    expect(result.rows_affected).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })

  test('a dry run reports dry_run and never issues the statement', async () => {
    const { executor, execute } = executorFor()
    const result = await update(executor, { dryRun: true })

    expect(result.status).toBe('dry_run')
    expect(result.rows_affected).toBe(0)
    expect(execute).not.toHaveBeenCalled()
  })

  test('a write that matched nothing is still a success, and says so', async () => {
    const { executor, execute } = executorFor(0)
    const result = await update(executor, { confirm: async () => true })

    // The case the old encoding collided with the two above.
    expect(result.status).toBe('success')
    expect(result.rows_affected).toBe(0)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('all four outcomes are distinguishable from one another', async () => {
    const statuses = new Set<string>()
    for (const [affected, options] of [
      [3, { confirm: async () => true }],
      [0, { confirm: async () => true }],
      [0, { confirm: async () => false }],
      [0, { dryRun: true }],
    ] as const) {
      const { executor } = executorFor(affected)
      const result = await update(executor, options)
      statuses.add(`${result.status}/${result.rows_affected}`)
    }

    expect([...statuses].sort()).toEqual(['cancelled/0', 'dry_run/0', 'success/0', 'success/3'])
  })

  test('a mutation with neither force nor a confirmer refuses loudly', async () => {
    const { executor, execute } = executorFor()
    const result = await update(executor, {})

    expect(result.status).toBe('error')
    expect(result.error).toContain('no confirmation handler')
    expect(execute).not.toHaveBeenCalled()
  })
})

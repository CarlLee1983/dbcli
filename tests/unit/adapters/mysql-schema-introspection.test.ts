import { expect, test } from 'bun:test'
import { MySQLAdapter } from '@/adapters/mysql-adapter'

test('getTableSchema uses a foreign-key query accepted by ONLY_FULL_GROUP_BY', async () => {
  const adapter = new MySQLAdapter({
    system: 'mysql',
    host: 'localhost',
    port: 3306,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  const executedSql: string[] = []

  ;(
    adapter as unknown as {
      db: { execute(sql: string): Promise<[unknown[], unknown[]]> }
    }
  ).db = {
    async execute(sql: string): Promise<[unknown[], unknown[]]> {
      executedSql.push(sql)
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (
        normalized.includes('information_schema.REFERENTIAL_CONSTRAINTS') &&
        !/GROUP BY rc\.CONSTRAINT_NAME, rc\.REFERENCED_TABLE_NAME/i.test(normalized)
      ) {
        const error = new Error(
          "Expression #3 of SELECT list contains nonaggregated column 'rc.REFERENCED_TABLE_NAME'; this is incompatible with sql_mode=only_full_group_by"
        ) as Error & { code: string; errno: number }
        error.code = 'ER_WRONG_FIELD_WITH_GROUP'
        error.errno = 1055
        throw error
      }
      return [[], []]
    },
  }

  await expect(adapter.getTableSchema('users')).resolves.toMatchObject({ name: 'users' })
  expect(
    executedSql.some((sql) => sql.includes('information_schema.REFERENTIAL_CONSTRAINTS'))
  ).toBe(true)
})

test('getTableSchema 的 row count 查詢跳脫表名中的反引號 (#39)', async () => {
  const adapter = new MySQLAdapter({
    system: 'mysql',
    host: 'localhost',
    port: 3306,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  const executedSql: string[] = []

  ;(
    adapter as unknown as {
      db: { execute(sql: string): Promise<[unknown[], unknown[]]> }
    }
  ).db = {
    async execute(sql: string): Promise<[unknown[], unknown[]]> {
      executedSql.push(sql)
      return [[], []]
    },
  }

  await adapter.getTableSchema('we`ird')

  const inlined = executedSql.filter((sql) => sql.includes('we'))
  expect(inlined.length).toBeGreaterThan(0)
  // 未跳脫時會產生 `we`ird`，反引號提前收尾、語法錯誤或指到別的物件
  for (const sql of inlined) {
    expect(sql).toContain('`we``ird`')
    expect(sql).not.toContain('`we`ird`')
  }
})

// ── 掃描降本（#49） ────────────────────────────────────────────────────────

function adapterWithSqlLog(rowsFor: (sql: string) => unknown[] = () => []) {
  const adapter = new MySQLAdapter({
    system: 'mysql',
    host: 'localhost',
    port: 3306,
    user: 'test',
    password: 'test',
    database: 'test',
  })
  const executedSql: string[] = []
  ;(
    adapter as unknown as {
      db: { execute(sql: string): Promise<[unknown[], unknown[]]> }
    }
  ).db = {
    async execute(sql: string): Promise<[unknown[], unknown[]]> {
      executedSql.push(sql)
      return [rowsFor(sql), []]
    },
  }
  return { adapter, executedSql }
}

test('單表 metadata 只查一次 information_schema.TABLES', async () => {
  const { adapter, executedSql } = adapterWithSqlLog((sql) =>
    sql.includes('information_schema.TABLES') ? [{ engine: 'InnoDB', estimated_rows: 42 }] : []
  )

  const schema = await adapter.getTableSchema('users')

  const tableMetaQueries = executedSql.filter((sql) => sql.includes('information_schema.TABLES'))
  expect(tableMetaQueries).toHaveLength(1)
  expect(schema.engine).toBe('InnoDB')
  expect(schema.estimatedRowCount).toBe(42)
})

test('exactRowCount: false 時不發全表 COUNT，改用估計列數', async () => {
  const { adapter, executedSql } = adapterWithSqlLog((sql) =>
    sql.includes('information_schema.TABLES') ? [{ engine: 'InnoDB', estimated_rows: 1234 }] : []
  )

  const schema = await adapter.getTableSchema('users', { exactRowCount: false })

  expect(executedSql.some((sql) => sql.includes('COUNT(*)'))).toBe(false)
  expect(schema.rowCount).toBe(1234)
  expect(schema.estimatedRowCount).toBe(1234)
})

test('預設仍是精確列數', async () => {
  const { adapter, executedSql } = adapterWithSqlLog((sql) =>
    sql.includes('COUNT(*)') ? [{ count: 7 }] : []
  )

  const schema = await adapter.getTableSchema('users')

  expect(executedSql.some((sql) => sql.includes('COUNT(*)'))).toBe(true)
  expect(schema.rowCount).toBe(7)
})

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

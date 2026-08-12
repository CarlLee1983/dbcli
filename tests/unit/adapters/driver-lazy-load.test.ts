/**
 * SQL driver 按需載入（#48）
 *
 * `pg` 與 `mysql2` 加起來約 50ms 的模組解析。查 Redis 或 Mongo 的命令不該
 * 為此付費，而只要 adapter 模組頂層有一行 value import，整條 import 鏈上的
 * 任何命令都會付——包含 `--help`。
 *
 * 這是結構契約而非行為斷言：真正的載入時機無法在同一個 process 內觀察，
 * 但「頂層沒有 value import」是可檢查的，而且正是會被不小心改回去的那一行。
 */

import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'

const ADAPTERS = [
  { file: 'postgresql-adapter.ts', driver: 'pg' },
  { file: 'mysql-adapter.ts', driver: 'mysql2/promise' },
  { file: 'mongodb-adapter.ts', driver: 'mongodb' },
] as const

describe('SQL/NoSQL driver 只在連線時載入', () => {
  for (const { file, driver } of ADAPTERS) {
    test(`${file} 頂層沒有 ${driver} 的 value import`, async () => {
      const source = await Bun.file(join(import.meta.dir, '../../../src/adapters', file)).text()
      const valueImport = new RegExp(
        `^import\\s+(?!type\\b)[^\\n]*from\\s+['"]${driver.replace('/', '\\/')}['"]`,
        'm'
      )
      expect(source).not.toMatch(valueImport)
    })

    test(`${file} 在執行期以 dynamic import 取得 ${driver}`, async () => {
      const source = await Bun.file(join(import.meta.dir, '../../../src/adapters', file)).text()
      expect(source).toContain(`await import('${driver}')`)
    })
  }
})

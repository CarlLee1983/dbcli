// src/core/guide/missing-index/parse-sql.ts
/**
 * node-sql-parser wrapper. Maps our DatabaseSystem to the library's dialect
 * string and guarantees the result is exactly one SELECT AST. Any parse error,
 * non-SELECT, or multi-statement input throws ParseFailure so the analyzer can
 * cleanly switch to fallback mode.
 */

import { Parser } from 'node-sql-parser'
import type { SqlDatabaseSystem } from '@/adapters/types'

export class ParseFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseFailure'
  }
}

const DIALECT: Record<SqlDatabaseSystem, string> = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'Postgresql',
}

const parser = new Parser()

export function parseSelect(sql: string, system: SqlDatabaseSystem): unknown {
  let ast: unknown
  try {
    ast = parser.astify(sql, { database: DIALECT[system] })
  } catch (e) {
    throw new ParseFailure(`SQL parse failed: ${(e as Error).message}`)
  }
  // astify returns an array when multiple statements are present.
  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw new ParseFailure('Only a single SELECT statement is supported')
    }
    ast = ast[0]
  }
  const node = ast as { type?: string }
  if (!node || node.type !== 'select') {
    throw new ParseFailure(`Only SELECT statements are analysed (got: ${node?.type ?? 'unknown'})`)
  }
  return ast
}

/**
 * node-sql-parser wrapper for lint. Unlike missing-index/parse-sql.ts this
 * accepts any single statement type — individual rules guard on ast.type.
 */
import type { SqlDatabaseSystem } from '@/adapters/types'
import type { AstNode } from '@/core/lint/types'
import { sqlParser } from '@/core/sql-parser'

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

export function parseSingleStatement(sql: string, system: SqlDatabaseSystem): AstNode {
  let ast: unknown
  try {
    ast = sqlParser().astify(sql, { database: DIALECT[system] })
  } catch (e) {
    throw new ParseFailure(`SQL parse failed: ${(e as Error).message}`)
  }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      throw new ParseFailure('Only a single SQL statement is supported')
    }
    ast = ast[0]
  }
  if (!ast || typeof ast !== 'object') {
    throw new ParseFailure('SQL parse produced no statement')
  }
  return ast as AstNode
}

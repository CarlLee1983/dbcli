import {
  collectTables,
  findingSpan,
  walkExpr,
  whereOf,
} from '@/core/lint/ast-utils'
import { verifyWith } from '@/core/lint/types'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

const NUMERIC = /int|serial|decimal|numeric|float|double|real|bigint|smallint/i
const TEXTUAL = /char|text|uuid|enum/i
const COMPARISONS = new Set(['=', '!=', '<>', '>', '>=', '<', '<='])

function columnKind(type: string): 'number' | 'string' | 'other' {
  if (NUMERIC.test(type)) return 'number'
  if (TEXTUAL.test(type)) return 'string'
  return 'other'
}

function literalKind(node: AstNode | undefined): 'number' | 'string' | null {
  if (!node) return null
  if (node.type === 'number') return 'number'
  if (node.type === 'single_quote_string' || node.type === 'string') {
    return 'string'
  }
  return null
}

function columnName(node: AstNode): string | null {
  if (typeof node.column === 'string') return node.column
  if (!node.column || typeof node.column !== 'object') return null

  const expression = (node.column as AstNode).expr
  if (!expression || typeof expression !== 'object') return null

  const value = (expression as AstNode).value
  return typeof value === 'string' ? value : null
}

export const implicitCastRule: LintRule = {
  name: 'implicit-cast',
  requiresSchema: true,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []

    const tables = collectTables(ctx.ast)
    const findings: LintFinding[] = []

    walkExpr(where, (node) => {
      if (node.type !== 'binary_expr') return
      if (!COMPARISONS.has(String(node.operator).toUpperCase())) return

      const left = node.left as AstNode | undefined
      if (left?.type !== 'column_ref') return

      const name = columnName(left)
      const right = node.right as AstNode | undefined
      const literal = literalKind(right)
      if (!name || !literal) return

      const resolved = ctx.schema.resolveColumn(tables, name)
      if (!resolved) return

      const column = columnKind(resolved.column.type)
      if (column === 'other' || column === literal) return

      const finding: LintFinding = {
        rule: 'implicit-cast',
        severity: 'warn',
        message: `Column '${resolved.column.name}' is ${resolved.column.type} but is compared to a ${literal} literal — the implicit cast can disable index use on '${resolved.column.name}'. Use a ${column} literal.`,
        span: findingSpan(ctx.sql, name),
        schemaVerified: true,
      }

      if (column === 'number' && literal === 'string') {
        const raw = String(right?.value)
        if (/^\d+(\.\d+)?$/.test(raw)) {
          const rewritten = ctx.sql
            .replace(`'${raw}'`, raw)
            .replace(`"${raw}"`, raw)
          finding.rewrite = { sql: rewritten, confidence: 'high' }
          finding.verifyCommand = verifyWith(rewritten)
        }
      }

      findings.push(finding)
    })

    return findings
  },
}

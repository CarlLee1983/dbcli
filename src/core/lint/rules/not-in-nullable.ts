import {
  columnRefParts,
  findingSpan,
  resolveColumnRef,
  walkExpr,
  whereOf,
} from '@/core/lint/ast-utils'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

interface NullHazard {
  kind: 'explicit-null' | 'nullable-expression' | 'nullable-subquery'
  expression?: string
}

function expressionName(node: AstNode): string | undefined {
  const reference = columnRefParts(node)
  if (!reference) return undefined
  return reference.qualifier
    ? `${reference.qualifier}.${reference.column}`
    : reference.column
}

function nullableExpression(
  node: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0]
): string | undefined {
  if (node.type === 'null') return 'NULL'

  if (node.type === 'column_ref') {
    const resolved = resolveColumnRef(schema, statement, node)
    return resolved?.column.nullable ? expressionName(node) : undefined
  }

  if (node.type === 'binary_expr' || node.type === 'unary_expr') {
    const left = node.left as AstNode | undefined
    const right = node.right as AstNode | undefined
    const expr = node.expr as AstNode | undefined
    for (const candidate of [left, right, expr]) {
      if (!candidate) continue
      const nullable = nullableExpression(candidate, statement, schema)
      if (nullable) return nullable
    }
  }

  return undefined
}

function projectedExpression(subquery: AstNode): AstNode | undefined {
  const columns = subquery.columns
  if (!Array.isArray(columns) || columns.length !== 1) return undefined
  const projection = columns[0] as AstNode
  return projection.expr as AstNode | undefined
}

function rhsHazard(
  right: AstNode | undefined,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0]
): NullHazard | undefined {
  const values = right?.value
  if (!Array.isArray(values)) return undefined

  for (const value of values) {
    const item = value as AstNode
    if (item.type === 'null') return { kind: 'explicit-null' }

    const subquery = item.ast
    if (subquery && typeof subquery === 'object') {
      const expression = projectedExpression(subquery as AstNode)
      if (!expression) continue
      const nullable = nullableExpression(
        expression,
        subquery as AstNode,
        schema
      )
      if (nullable) {
        return { kind: 'nullable-subquery', expression: nullable }
      }
      continue
    }

    const nullable = nullableExpression(item, statement, schema)
    if (nullable) {
      return { kind: 'nullable-expression', expression: nullable }
    }
  }

  return undefined
}

function hazardMessage(hazard: NullHazard): string {
  if (hazard.kind === 'explicit-null') {
    return 'The right-hand NOT IN list contains NULL, so the predicate cannot evaluate to true. Remove NULL or filter it before applying NOT IN.'
  }
  if (hazard.kind === 'nullable-subquery') {
    return `The NOT IN subquery projects nullable expression '${hazard.expression}', so a NULL can suppress every result. Filter the projected value in the subquery with WHERE ${hazard.expression} IS NOT NULL. Do not mechanically rewrite this predicate to NOT EXISTS unless correlation, types, and multiplicity semantics are proven equivalent.`
  }
  return `The right-hand NOT IN expression '${hazard.expression}' is nullable according to schema, so it can suppress every result. Filter NULL values before applying NOT IN.`
}

export const notInNullableRule: LintRule = {
  name: 'not-in-nullable',
  requiresSchema: true,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []

    const findings: LintFinding[] = []

    walkExpr(where, (node) => {
      if (
        node.type !== 'binary_expr' ||
        String(node.operator).toUpperCase() !== 'NOT IN'
      ) {
        return
      }

      const hazard = rhsHazard(
        node.right as AstNode | undefined,
        ctx.ast,
        ctx.schema
      )
      if (!hazard) return

      const whereIndex = ctx.sql.toLowerCase().indexOf('where')

      findings.push({
        rule: 'not-in-nullable',
        severity: 'warn',
        message: hazardMessage(hazard),
        span: findingSpan(
          ctx.sql,
          'not in',
          whereIndex === -1 ? 0 : whereIndex
        ),
        schemaVerified: true,
      })
    })

    return findings
  },
}

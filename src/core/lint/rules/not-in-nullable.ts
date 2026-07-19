import {
  columnRefParts,
  lexicalFindingSpan,
  resolveColumnRef,
  topLevelWhereClauseRange,
  walkExprInStatement,
  whereOf,
} from '@/core/lint/ast-utils'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

interface NullHazard {
  kind: 'explicit-null' | 'nullable-expression' | 'nullable-subquery'
  expression?: string
  compoundProjection?: boolean
}

const NULL_PROPAGATING_BINARY = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  '=',
  '!=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'ILIKE',
  'NOT LIKE',
  'NOT ILIKE',
  'IN',
  'NOT IN',
  'AND',
  'OR',
])
const NULL_PROPAGATING_UNARY = new Set(['+', '-', '~', 'NOT'])

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

  if (
    node.type === 'binary_expr' &&
    NULL_PROPAGATING_BINARY.has(String(node.operator).toUpperCase())
  ) {
    const left = node.left as AstNode | undefined
    const right = node.right as AstNode | undefined
    for (const candidate of [left, right]) {
      if (!candidate) continue
      const nullable = nullableExpression(candidate, statement, schema)
      if (nullable) return nullable
    }
  }

  if (
    node.type === 'unary_expr' &&
    NULL_PROPAGATING_UNARY.has(String(node.operator).toUpperCase())
  ) {
    const expression = node.expr as AstNode | undefined
    if (expression) return nullableExpression(expression, statement, schema)
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
        return {
          kind: 'nullable-subquery',
          expression: nullable,
          compoundProjection: expression.type !== 'column_ref',
        }
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
    if (hazard.compoundProjection) {
      return `The NOT IN subquery projects a nullable expression involving '${hazard.expression}', so a NULL can suppress every result. Filter the projected expression itself with IS NOT NULL, or guard every nullable input. Do not mechanically rewrite this predicate to NOT EXISTS unless correlation, types, and multiplicity semantics are proven equivalent.`
    }
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
    const whereRange = topLevelWhereClauseRange(ctx.sql)
    if (!whereRange) return []

    const findings: LintFinding[] = []
    let notInSearchIndex = whereRange.start

    walkExprInStatement(where, (node) => {
      if (
        node.type !== 'binary_expr' ||
        String(node.operator).toUpperCase() !== 'NOT IN'
      ) {
        return
      }

      const candidateSpan = lexicalFindingSpan(
        ctx.sql,
        'not in',
        notInSearchIndex
      )
      const hasExactSpan =
        candidateSpan.start >= notInSearchIndex &&
        candidateSpan.end <= whereRange.end &&
        ctx.sql
          .slice(candidateSpan.start, candidateSpan.end)
          .toLowerCase() === 'not in'
      if (hasExactSpan) notInSearchIndex = candidateSpan.end

      const hazard = rhsHazard(
        node.right as AstNode | undefined,
        ctx.ast,
        ctx.schema
      )
      if (!hazard) return

      findings.push({
        rule: 'not-in-nullable',
        severity: 'warn',
        message: hazardMessage(hazard),
        span: hasExactSpan ? candidateSpan : whereRange,
        schemaVerified: true,
      })
    })

    return findings
  },
}

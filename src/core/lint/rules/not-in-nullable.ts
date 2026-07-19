import {
  columnRefParts,
  lexicalFindingSpan,
  resolveColumnRef,
  topLevelWhereClauseRange,
  walkExprInStatement,
  whereOf,
} from '@/core/lint/ast-utils'
import type { SqlDatabaseSystem } from '@/adapters/types'
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
const COMMON_NULL_ON_EMPTY_AGGREGATES = [
  'MIN',
  'MAX',
  'AVG',
  'SUM',
] as const
const NULL_ON_EMPTY_AGGREGATES: Record<
  SqlDatabaseSystem,
  ReadonlySet<string>
> = {
  postgresql: new Set([
    ...COMMON_NULL_ON_EMPTY_AGGREGATES,
    'ARRAY_AGG',
    'STRING_AGG',
    'JSON_AGG',
    'JSONB_AGG',
    'JSON_ARRAYAGG',
    'JSON_OBJECT_AGG',
    'JSONB_OBJECT_AGG',
    'JSON_OBJECTAGG',
    'XMLAGG',
    'BIT_AND',
    'BIT_OR',
    'BOOL_AND',
    'BOOL_OR',
    'EVERY',
    'RANGE_AGG',
    'RANGE_INTERSECT_AGG',
  ]),
  mysql: new Set([
    ...COMMON_NULL_ON_EMPTY_AGGREGATES,
    'GROUP_CONCAT',
    'JSON_ARRAYAGG',
    'JSON_OBJECTAGG',
    'STD',
    'STDDEV',
    'STDDEV_POP',
    'STDDEV_SAMP',
    'VARIANCE',
    'VAR_POP',
    'VAR_SAMP',
  ]),
  mariadb: new Set([
    ...COMMON_NULL_ON_EMPTY_AGGREGATES,
    'GROUP_CONCAT',
    'JSON_ARRAYAGG',
    'JSON_OBJECTAGG',
    'STD',
    'STDDEV',
    'STDDEV_POP',
    'STDDEV_SAMP',
    'VARIANCE',
    'VAR_POP',
    'VAR_SAMP',
  ]),
}

interface RelationBinding {
  table: string
  qualifier: string
  nullExtended: boolean
}

function expressionName(node: AstNode): string | undefined {
  const reference = columnRefParts(node)
  if (!reference) return undefined
  return reference.qualifier
    ? `${reference.qualifier}.${reference.column}`
    : reference.column
}

function relationBindings(statement: AstNode): RelationBinding[] {
  if (!Array.isArray(statement.from)) return []
  const bindings: RelationBinding[] = []

  for (const item of statement.from) {
    const source = item as AstNode
    const join = typeof source.join === 'string'
      ? source.join.toUpperCase()
      : ''
    const nullExtendsPrevious =
      join.startsWith('RIGHT') || join.startsWith('FULL')
    const nullExtendsCurrent =
      join.startsWith('LEFT') || join.startsWith('FULL')

    if (nullExtendsPrevious) {
      for (const binding of bindings) binding.nullExtended = true
    }

    if (typeof source.table !== 'string') continue
    const qualifier =
      typeof source.as === 'string' && source.as.length > 0
        ? source.as
        : source.table
    bindings.push({
      table: source.table,
      qualifier,
      nullExtended: nullExtendsCurrent,
    })
  }

  return bindings
}

function columnIsNullExtended(
  node: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0]
): boolean {
  const reference = columnRefParts(node)
  if (!reference) return false
  const bindings = relationBindings(statement)

  if (reference.qualifier) {
    const matches = bindings.filter(
      (binding) =>
        binding.qualifier.toLowerCase() === reference.qualifier?.toLowerCase()
    )
    return matches.length === 1 && matches[0]!.nullExtended
  }

  const resolved = resolveColumnRef(schema, statement, node)
  if (!resolved) return false
  const matches = bindings.filter((binding) => {
    const candidate = schema.resolveColumn([binding.table], reference.column)
    return (
      candidate?.table === resolved.table &&
      candidate.column.name === resolved.column.name
    )
  })
  return matches.length === 1 && matches[0]!.nullExtended
}

function aggregateName(node: AstNode): string | undefined {
  if (typeof node.name === 'string') return node.name.toUpperCase()
  if (!node.name || typeof node.name !== 'object') return undefined
  const parts = (node.name as AstNode).name
  if (!Array.isArray(parts) || parts.length !== 1) return undefined
  const part = parts[0] as AstNode
  if (typeof part.value === 'string') return part.value.toUpperCase()
  return undefined
}

function nullableExpression(
  node: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0],
  system: SqlDatabaseSystem
): string | undefined {
  if (node.type === 'null') return 'NULL'

  if (node.type === 'column_ref') {
    const resolved = resolveColumnRef(schema, statement, node)
    return resolved?.column.nullable ||
      (resolved !== undefined && columnIsNullExtended(node, statement, schema))
      ? expressionName(node)
      : undefined
  }

  if (node.type === 'case') {
    const args = Array.isArray(node.args) ? (node.args as AstNode[]) : []
    const otherwise = args.find((argument) => argument.type === 'else')
    if (!otherwise) return 'CASE expression'

    for (const argument of args) {
      const result = argument.result as AstNode | undefined
      if (!result) continue
      const nullable = nullableExpression(result, statement, schema, system)
      if (nullable) return nullable
    }
    return undefined
  }

  if (node.type === 'aggr_func' || node.type === 'function') {
    const name = aggregateName(node)
    if (name && NULL_ON_EMPTY_AGGREGATES[system].has(name)) {
      return `${name} aggregate`
    }
    return undefined
  }

  if (node.type === 'cast') {
    const expression = node.expr as AstNode | undefined
    if (expression) {
      return nullableExpression(expression, statement, schema, system)
    }
  }

  if (
    node.type === 'binary_expr' &&
    NULL_PROPAGATING_BINARY.has(String(node.operator).toUpperCase())
  ) {
    const left = node.left as AstNode | undefined
    const right = node.right as AstNode | undefined
    for (const candidate of [left, right]) {
      if (!candidate) continue
      const nullable = nullableExpression(candidate, statement, schema, system)
      if (nullable) return nullable
    }
  }

  if (
    node.type === 'unary_expr' &&
    NULL_PROPAGATING_UNARY.has(String(node.operator).toUpperCase())
  ) {
    const expression = node.expr as AstNode | undefined
    if (expression) {
      return nullableExpression(expression, statement, schema, system)
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

function equivalentExpression(
  left: AstNode,
  right: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0]
): boolean {
  if (left.type !== right.type) return false

  if (left.type === 'column_ref') {
    const leftResolved = resolveColumnRef(schema, statement, left)
    const rightResolved = resolveColumnRef(schema, statement, right)
    if (
      leftResolved !== undefined &&
      rightResolved !== undefined &&
      leftResolved.table === rightResolved.table &&
      leftResolved.column.name === rightResolved.column.name
    ) {
      return true
    }
    if (schema.available) return false

    const leftReference = columnRefParts(left)
    const rightReference = columnRefParts(right)
    return (
      leftReference !== null &&
      rightReference !== null &&
      leftReference.qualifier?.toLowerCase() ===
        rightReference.qualifier?.toLowerCase() &&
      leftReference.column.toLowerCase() === rightReference.column.toLowerCase()
    )
  }

  if (
    left.type === 'number' ||
    left.type === 'single_quote_string' ||
    left.type === 'string' ||
    left.type === 'null'
  ) {
    return left.value === right.value
  }

  if (left.type === 'binary_expr') {
    const leftLeft = left.left as AstNode | undefined
    const leftRight = left.right as AstNode | undefined
    const rightLeft = right.left as AstNode | undefined
    const rightRight = right.right as AstNode | undefined
    return (
      String(left.operator).toUpperCase() ===
        String(right.operator).toUpperCase() &&
      !!leftLeft &&
      !!leftRight &&
      !!rightLeft &&
      !!rightRight &&
      equivalentExpression(leftLeft, rightLeft, statement, schema) &&
      equivalentExpression(leftRight, rightRight, statement, schema)
    )
  }

  if (left.type === 'unary_expr') {
    const leftExpr = left.expr as AstNode | undefined
    const rightExpr = right.expr as AstNode | undefined
    return (
      String(left.operator).toUpperCase() ===
        String(right.operator).toUpperCase() &&
      !!leftExpr &&
      !!rightExpr &&
      equivalentExpression(leftExpr, rightExpr, statement, schema)
    )
  }

  if (
    left.type === 'case' ||
    left.type === 'aggr_func' ||
    left.type === 'function' ||
    left.type === 'cast'
  ) {
    return equivalentStructure(left, right, statement, schema)
  }

  return false
}

function equivalentStructure(
  left: unknown,
  right: unknown,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0]
): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        equivalentStructure(value, right[index], statement, schema)
      )
    )
  }
  if (
    !left ||
    typeof left !== 'object' ||
    !right ||
    typeof right !== 'object'
  ) {
    return false
  }

  const leftNode = left as AstNode
  const rightNode = right as AstNode
  if (leftNode.type === 'column_ref' || rightNode.type === 'column_ref') {
    return equivalentExpression(leftNode, rightNode, statement, schema)
  }

  const leftKeys = Object.keys(leftNode).sort()
  const rightKeys = Object.keys(rightNode).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) =>
      equivalentStructure(leftNode[key], rightNode[key], statement, schema)
    )
  )
}

function predicateNullRejectsProjection(
  predicate: AstNode | undefined,
  projection: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0]
): boolean {
  if (!predicate || predicate.type !== 'binary_expr') return false
  const operator = String(predicate.operator).toUpperCase()
  if (operator === 'OR') return false
  if (operator === 'AND') {
    return (
      predicateNullRejectsProjection(
        predicate.left as AstNode | undefined,
        projection,
        statement,
        schema
      ) ||
      predicateNullRejectsProjection(
        predicate.right as AstNode | undefined,
        projection,
        statement,
        schema
      )
    )
  }
  if (operator !== 'IS NOT' && operator !== 'IS NOT NULL') return false

  const testedExpression = predicate.left as AstNode | undefined
  const right = predicate.right as AstNode | undefined
  if (!testedExpression || (operator === 'IS NOT' && right?.type !== 'null')) {
    return false
  }
  return equivalentExpression(
    testedExpression,
    projection,
    statement,
    schema
  )
}

function rhsHazard(
  right: AstNode | undefined,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0],
  system: SqlDatabaseSystem
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
        schema,
        system
      )
      if (
        nullable &&
        ![
          (subquery as AstNode).where,
          (subquery as AstNode).having,
        ].some((predicate) =>
          predicateNullRejectsProjection(
            predicate as AstNode | undefined,
            expression,
            subquery as AstNode,
            schema
          )
        )
      ) {
        return {
          kind: 'nullable-subquery',
          expression: nullable,
          compoundProjection: expression.type !== 'column_ref',
        }
      }
      continue
    }

    const nullable = nullableExpression(item, statement, schema, system)
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
  requiresSchema: false,
  usesOptionalSchema: true,
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
        ctx.schema,
        ctx.system
      )
      if (!hazard) return

      findings.push({
        rule: 'not-in-nullable',
        severity: 'warn',
        message: hazardMessage(hazard),
        span: hasExactSpan ? candidateSpan : whereRange,
        schemaVerified: ctx.schema.available,
      })
    })

    return findings
  },
}

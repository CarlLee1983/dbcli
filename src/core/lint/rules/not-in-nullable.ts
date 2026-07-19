import {
  columnRefParts,
  lexicalFindingSpan,
  resolveColumnRef,
} from '@/core/lint/ast-utils'
import type { SqlDatabaseSystem } from '@/adapters/types'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

interface NullHazard {
  kind: 'explicit-null' | 'nullable-expression' | 'nullable-subquery'
  expression?: string
  compoundProjection?: boolean
  schemaVerified: boolean
}

interface NullableFact {
  expression: string
  schemaVerified: boolean
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
const NULL_ON_EMPTY_FUNCTION_AGGREGATES: Record<
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
    'BIT_XOR',
    'BOOL_AND',
    'BOOL_OR',
    'EVERY',
    'RANGE_AGG',
    'RANGE_INTERSECT_AGG',
    'ANY_VALUE',
    'CORR',
    'COVAR_POP',
    'COVAR_SAMP',
    'REGR_AVGX',
    'REGR_AVGY',
    'REGR_INTERCEPT',
    'REGR_R2',
    'REGR_SLOPE',
    'REGR_SXX',
    'REGR_SXY',
    'REGR_SYY',
    'STDDEV',
    'STDDEV_POP',
    'STDDEV_SAMP',
    'VARIANCE',
    'VAR_POP',
    'VAR_SAMP',
    'MODE',
    'PERCENTILE_CONT',
    'PERCENTILE_DISC',
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
const NON_NULL_AGGREGATES: Record<SqlDatabaseSystem, ReadonlySet<string>> = {
  postgresql: new Set(['COUNT', 'REGR_COUNT']),
  mysql: new Set(['COUNT', 'BIT_AND', 'BIT_OR', 'BIT_XOR']),
  mariadb: new Set(['COUNT', 'BIT_AND', 'BIT_OR', 'BIT_XOR']),
}

interface RelationBinding {
  table?: string
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

    const table =
      typeof source.table === 'string' ? source.table : undefined
    const qualifier =
      typeof source.as === 'string' && source.as.length > 0
        ? source.as
        : table
    if (!qualifier) continue
    bindings.push({
      ...(table === undefined ? {} : { table }),
      qualifier,
      nullExtended: nullExtendsCurrent,
    })
  }

  return bindings
}

function columnNullExtension(
  node: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0],
  allowSchema: boolean
): { schemaVerified: boolean } | undefined {
  const reference = columnRefParts(node)
  if (!reference) return undefined
  const bindings = relationBindings(statement)

  if (reference.qualifier) {
    const matches = bindings.filter(
      (binding) =>
        binding.qualifier.toLowerCase() === reference.qualifier?.toLowerCase()
    )
    return matches.length === 1 && matches[0]!.nullExtended
      ? { schemaVerified: false }
      : undefined
  }

  if (!allowSchema) return undefined
  const resolved = resolveColumnRef(schema, statement, node)
  if (!resolved) return undefined
  const matches = bindings.filter((binding) => {
    if (!binding.table) return false
    const candidate = schema.resolveColumn([binding.table], reference.column)
    return (
      candidate?.table === resolved.table &&
      candidate.column.name === resolved.column.name
    )
  })
  return matches.length === 1 && matches[0]!.nullExtended
    ? { schemaVerified: true }
    : undefined
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

function scopedProjectedExpression(
  node: AstNode,
  statement: AstNode
): { expression: AstNode; statement: AstNode } | undefined {
  const reference = columnRefParts(node)
  const sources = Array.isArray(statement.from)
    ? (statement.from as AstNode[])
    : []
  if (!reference || sources.length !== 1) return undefined

  const source = sources[0]!
  const sourceQualifier =
    typeof source.as === 'string'
      ? source.as
      : typeof source.table === 'string'
        ? source.table
        : undefined
  if (
    reference.qualifier &&
    sourceQualifier?.toLowerCase() !== reference.qualifier.toLowerCase()
  ) {
    return undefined
  }

  let scopedStatement: AstNode | undefined
  const sourceTable = source.table
  if (source.expr && typeof source.expr === 'object') {
    const derived = source.expr as AstNode
    if (derived.ast && typeof derived.ast === 'object') {
      scopedStatement = derived.ast as AstNode
    }
  } else if (
    typeof sourceTable === 'string' &&
    (source.db === null || source.db === undefined) &&
    Array.isArray(statement.with)
  ) {
    const matches = (statement.with as AstNode[]).filter((binding) => {
      if (!binding.name || typeof binding.name !== 'object') return false
      const value = (binding.name as AstNode).value
      return (
        typeof value === 'string' &&
        value.toLowerCase() === sourceTable.toLowerCase()
      )
    })
    if (matches.length !== 1) return undefined
    const stmt = matches[0]!.stmt
    if (stmt && typeof stmt === 'object') scopedStatement = stmt as AstNode
  }

  if (!scopedStatement || !Array.isArray(scopedStatement.columns)) {
    return undefined
  }
  const outputs = (scopedStatement.columns as AstNode[]).filter(
    (column) =>
      typeof column.as === 'string' &&
      column.as.toLowerCase() === reference.column.toLowerCase() &&
      column.expr &&
      typeof column.expr === 'object'
  )
  if (outputs.length !== 1) return undefined
  return {
    expression: outputs[0]!.expr as AstNode,
    statement: scopedStatement,
  }
}

function nullableExpression(
  node: AstNode,
  statement: AstNode,
  schema: Parameters<typeof resolveColumnRef>[0],
  system: SqlDatabaseSystem,
  allowSchema = true
): NullableFact | undefined {
  if (node.type === 'null') {
    return { expression: 'NULL', schemaVerified: false }
  }

  if (node.type === 'column_ref') {
    const nullExtension = columnNullExtension(
      node,
      statement,
      schema,
      allowSchema
    )
    if (nullExtension) {
      return {
        expression: expressionName(node) ?? 'column',
        schemaVerified: nullExtension.schemaVerified,
      }
    }

    if (allowSchema) {
      const resolved = resolveColumnRef(schema, statement, node)
      if (resolved?.column.nullable) {
        return {
          expression: expressionName(node) ?? 'column',
          schemaVerified: true,
        }
      }
    }

    const scoped = scopedProjectedExpression(node, statement)
    if (scoped) {
      const nullable = nullableExpression(
        scoped.expression,
        scoped.statement,
        schema,
        system,
        false
      )
      return nullable
        ? {
            ...nullable,
            expression: expressionName(node) ?? nullable.expression,
          }
        : undefined
    }
    return undefined
  }

  if (node.type === 'case') {
    const args = Array.isArray(node.args) ? (node.args as AstNode[]) : []
    const otherwise = args.find((argument) => argument.type === 'else')
    if (!otherwise) {
      return { expression: 'CASE expression', schemaVerified: false }
    }

    for (const argument of args) {
      const result = argument.result as AstNode | undefined
      if (!result) continue
      const nullable = nullableExpression(
        result,
        statement,
        schema,
        system,
        allowSchema
      )
      if (nullable) return nullable
    }
    return undefined
  }

  if (node.type === 'aggr_func') {
    const name = aggregateName(node)
    if (!name || !NON_NULL_AGGREGATES[system].has(name)) {
      return {
        expression: `${name ?? 'unknown'} aggregate`,
        schemaVerified: false,
      }
    }
    return undefined
  }

  if (node.type === 'function') {
    const name = aggregateName(node)
    if (name && NULL_ON_EMPTY_FUNCTION_AGGREGATES[system].has(name)) {
      return { expression: `${name} aggregate`, schemaVerified: false }
    }
    return undefined
  }

  if (node.type === 'cast') {
    const expression = node.expr as AstNode | undefined
    if (expression) {
      return nullableExpression(
        expression,
        statement,
        schema,
        system,
        allowSchema
      )
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
      const nullable = nullableExpression(
        candidate,
        statement,
        schema,
        system,
        allowSchema
      )
      if (nullable) return nullable
    }
  }

  if (
    node.type === 'unary_expr' &&
    NULL_PROPAGATING_UNARY.has(String(node.operator).toUpperCase())
  ) {
    const expression = node.expr as AstNode | undefined
    if (expression) {
      return nullableExpression(
        expression,
        statement,
        schema,
        system,
        allowSchema
      )
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
    if (item.type === 'null') {
      return { kind: 'explicit-null', schemaVerified: false }
    }

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
          expression: nullable.expression,
          compoundProjection: expression.type !== 'column_ref',
          schemaVerified: nullable.schemaVerified,
        }
      }
      continue
    }

    const nullable = nullableExpression(item, statement, schema, system)
    if (nullable) {
      return {
        kind: 'nullable-expression',
        expression: nullable.expression,
        schemaVerified: nullable.schemaVerified,
      }
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
  return `The right-hand NOT IN expression '${hazard.expression}' can evaluate to NULL, so it can suppress every result. Filter NULL values before applying NOT IN.`
}

type NotInVisitor = (node: AstNode, statement: AstNode) => void

function visitExpression(
  value: unknown,
  statement: AstNode,
  visitNotIn: NotInVisitor
): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) visitExpression(item, statement, visitNotIn)
    return
  }

  const node = value as AstNode
  if (node.ast && typeof node.ast === 'object') {
    visitStatement(node.ast as AstNode, visitNotIn)
    return
  }

  if (
    node.type === 'binary_expr' &&
    String(node.operator).toUpperCase() === 'NOT IN'
  ) {
    visitNotIn(node, statement)
  }

  for (const key of ['left', 'right', 'args', 'value', 'expr', 'columns']) {
    if (key in node) visitExpression(node[key], statement, visitNotIn)
  }
}

function visitStatement(statement: AstNode, visitNotIn: NotInVisitor): void {
  if (Array.isArray(statement.with)) {
    for (const binding of statement.with as AstNode[]) {
      const nested = binding.stmt
      if (nested && typeof nested === 'object') {
        visitStatement(nested as AstNode, visitNotIn)
      }
    }
  }

  if (Array.isArray(statement.columns)) {
    for (const column of statement.columns as AstNode[]) {
      visitExpression(column.expr, statement, visitNotIn)
    }
  }

  if (Array.isArray(statement.from)) {
    for (const source of statement.from as AstNode[]) {
      visitExpression(source.expr, statement, visitNotIn)
      visitExpression(source.on, statement, visitNotIn)
    }
  }

  visitExpression(statement.where, statement, visitNotIn)
  visitExpression(statement.groupby, statement, visitNotIn)
  visitExpression(statement.having, statement, visitNotIn)
  visitExpression(statement.window, statement, visitNotIn)
  visitExpression(statement.orderby, statement, visitNotIn)
  visitExpression(statement.limit, statement, visitNotIn)

  if (statement._next && typeof statement._next === 'object') {
    visitStatement(statement._next as AstNode, visitNotIn)
  }
}

export const notInNullableRule: LintRule = {
  name: 'not-in-nullable',
  requiresSchema: false,
  usesOptionalSchema: true,
  check(ctx) {
    const findings: LintFinding[] = []
    let notInSearchIndex = 0

    visitStatement(ctx.ast, (node, statement) => {
      const candidateSpan = lexicalFindingSpan(
        ctx.sql,
        'not in',
        notInSearchIndex
      )
      const hasExactSpan =
        candidateSpan.start >= notInSearchIndex &&
        ctx.sql
          .slice(candidateSpan.start, candidateSpan.end)
          .toLowerCase() === 'not in'
      if (hasExactSpan) notInSearchIndex = candidateSpan.end

      const hazard = rhsHazard(
        node.right as AstNode | undefined,
        statement,
        ctx.schema,
        ctx.system
      )
      if (!hazard) return

      findings.push({
        rule: 'not-in-nullable',
        severity: 'warn',
        message: hazardMessage(hazard),
        span: hasExactSpan
          ? candidateSpan
          : { start: 0, end: ctx.sql.length },
        schemaVerified: hazard.schemaVerified,
      })
    })

    return findings
  },
}

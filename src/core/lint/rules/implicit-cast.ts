import {
  columnRefParts,
  findingSpan,
  resolveColumnRef,
  sqlCodeMask,
  topLevelWhereClauseRange,
  walkExprInStatement,
  whereOf,
} from '@/core/lint/ast-utils'
import { verifyWith } from '@/core/lint/types'
import type { AstNode, LintFinding, LintRule } from '@/core/lint/types'

const NUMERIC = new Set([
  'smallint',
  'tinyint',
  'mediumint',
  'integer',
  'int',
  'bigint',
  'int2',
  'int4',
  'int8',
  'smallserial',
  'serial',
  'bigserial',
  'decimal',
  'numeric',
  'real',
  'float',
  'float4',
  'float8',
  'double',
  'double precision',
])
const TEXTUAL = new Set([
  'char',
  'character',
  'varchar',
  'character varying',
  'text',
  'tinytext',
  'mediumtext',
  'longtext',
  'uuid',
  'enum',
])
const COMPARISONS = new Set(['=', '!=', '<>', '>', '>=', '<', '<='])

function columnKind(type: string): 'number' | 'string' | 'other' {
  const normalized = type
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+(unsigned|zerofill)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (NUMERIC.has(normalized)) return 'number'
  if (TEXTUAL.has(normalized)) return 'string'
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function identifierPattern(value: string): string {
  const escaped = escapeRegex(value)
  return `(?:"${escaped}"|\`${escaped}\`|${escaped})`
}

function comparisonMatches(
  sql: string,
  range: { start: number; end: number },
  columnNode: AstNode,
  operator: string,
  literalNode: AstNode,
  literalOnLeft: boolean
): RegExpMatchArray[] {
  const reference = columnRefParts(columnNode)
  if (!reference) return []

  const columnPattern = reference.qualifier
    ? `${identifierPattern(reference.qualifier)}\\s*\\.\\s*${identifierPattern(reference.column)}`
    : identifierPattern(reference.column)

  let literalPattern: string
  if (literalNode.type === 'number') {
    literalPattern = escapeRegex(String(literalNode.value))
  } else if (literalNode.type === 'single_quote_string' || literalNode.type === 'string') {
    const raw = String(literalNode.value).replace(/'/g, "''")
    literalPattern = `'${escapeRegex(raw)}'`
  } else {
    return []
  }

  const pattern = literalOnLeft
    ? `(${literalPattern})\\s*${escapeRegex(operator)}\\s*${columnPattern}`
    : `${columnPattern}\\s*${escapeRegex(operator)}\\s*(${literalPattern})`
  const boundedPattern = `(?<![A-Za-z0-9_$])${pattern}(?![A-Za-z0-9_$])`
  const mask = sqlCodeMask(sql)
  const regex = new RegExp(boundedPattern, 'gi')
  regex.lastIndex = range.start
  const matches: RegExpMatchArray[] = []
  let match = regex.exec(sql)

  while (match && match.index < range.end) {
    if (match.index === undefined || !mask[match.index]) {
      match = regex.exec(sql)
      continue
    }
    if (match.index < range.start || match.index + match[0].length > range.end) {
      match = regex.exec(sql)
      continue
    }
    const literal = match[1]
    if (!literal) {
      match = regex.exec(sql)
      continue
    }
    const literalIndex = match.index + match[0].lastIndexOf(literal)
    if (mask[literalIndex] === true) matches.push(match)
    match = regex.exec(sql)
  }

  return matches
}

export const implicitCastRule: LintRule = {
  name: 'implicit-cast',
  requiresSchema: true,
  check(ctx) {
    const where = whereOf(ctx.ast)
    if (!where) return []
    const whereRange = topLevelWhereClauseRange(ctx.sql)
    if (!whereRange) return []

    const findings: LintFinding[] = []
    let hasNestedStatement = false
    walkExprInStatement(where, (node) => {
      if (node.ast && typeof node.ast === 'object') {
        hasNestedStatement = true
      }
    })

    walkExprInStatement(where, (node) => {
      if (node.type !== 'binary_expr') return
      if (!COMPARISONS.has(String(node.operator).toUpperCase())) return

      const left = node.left as AstNode | undefined
      const right = node.right as AstNode | undefined
      if (!left || !right) return

      const literalOnLeft = literalKind(left) !== null && right.type === 'column_ref'
      const columnNode = (
        literalOnLeft
          ? right
          : left.type === 'column_ref' && literalKind(right) !== null
            ? left
            : undefined
      ) as AstNode | undefined
      const literalNode = (literalOnLeft ? left : columnNode ? right : undefined) as
        | AstNode
        | undefined
      const reference = columnNode ? columnRefParts(columnNode) : null
      const literal = literalKind(literalNode)
      if (!reference || !columnNode || !literalNode || !literal) return

      const resolved = resolveColumnRef(ctx.schema, ctx.ast, columnNode)
      if (!resolved) return

      const column = columnKind(resolved.column.type)
      if (column === 'other' || column === literal) return

      const matches = hasNestedStatement
        ? []
        : comparisonMatches(
            ctx.sql,
            whereRange,
            columnNode,
            String(node.operator),
            literalNode,
            literalOnLeft
          )
      const match = matches.length === 1 ? matches[0] : undefined
      const matchIndex = match?.index
      const whereIndex = ctx.sql.toLowerCase().indexOf('where')
      const finding: LintFinding = {
        rule: 'implicit-cast',
        severity: 'warn',
        message: `Column '${resolved.column.name}' is ${resolved.column.type} but is compared to a ${literal} literal — the implicit cast can disable index use on '${resolved.column.name}'. Use a ${column} literal.`,
        span:
          match && matchIndex !== undefined
            ? {
                start: matchIndex,
                end: matchIndex + match[0].length,
              }
            : findingSpan(ctx.sql, String(node.operator), whereIndex === -1 ? 0 : whereIndex),
        schemaVerified: true,
      }

      if (column === 'number' && literal === 'string' && match && matchIndex !== undefined) {
        const raw = String(literalNode.value)
        if (/^\d+(\.\d+)?$/.test(raw)) {
          const literalSource = match[1]
          const literalOffset = literalSource ? match[0].lastIndexOf(literalSource) : -1
          if (literalOffset === -1 || !literalSource) {
            findings.push(finding)
            return
          }
          const literalStart = matchIndex + literalOffset
          const rewritten =
            ctx.sql.slice(0, literalStart) +
            raw +
            ctx.sql.slice(literalStart + literalSource.length)
          finding.rewrite = { sql: rewritten, confidence: 'high' }
          finding.verifyCommand = verifyWith(rewritten, ctx.system)
        }
      }

      findings.push(finding)
    })

    return findings
  },
}

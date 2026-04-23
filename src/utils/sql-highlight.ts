import pc from 'picocolors'

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'CROSS',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'TABLE',
  'INDEX',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'UNION',
  'ALL',
  'ASC',
  'DESC',
]

const KEYWORD_PATTERN = new RegExp(`\\b(${SQL_KEYWORDS.join('|')})\\b`, 'gi')

const STRING_PATTERN = /'[^']*'/g
const NUMBER_PATTERN = /\b(\d+(?:\.\d+)?)\b/g

export function highlightSQL(sql: string): string {
  if (!sql) return sql

  if (process.env.NO_COLOR) return sql

  const strings: string[] = []
  let result = sql.replace(STRING_PATTERN, (match) => {
    strings.push(match)
    return `__STR_${strings.length - 1}__`
  })

  result = result.replace(KEYWORD_PATTERN, (match) => pc.blue(pc.bold(match.toUpperCase())))

  result = result.replace(NUMBER_PATTERN, (match) => pc.yellow(match))

  result = result.replace(/__STR_(\d+)__/g, (_, index) => pc.green(strings[parseInt(index)]))

  return result
}

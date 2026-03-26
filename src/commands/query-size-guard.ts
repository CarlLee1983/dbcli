import { getSizeCategory } from '@/core/size-category'

interface TableSizeInfo {
  estimatedRowCount: number
}

interface GuardResult {
  blocked: boolean
  reason?: string
  sizeCategory?: string
}

export function shouldBlockQuery(
  sql: string,
  tableSizeInfo: TableSizeInfo | undefined
): GuardResult {
  if (!tableSizeInfo) {
    return { blocked: false }
  }

  const category = getSizeCategory(tableSizeInfo.estimatedRowCount)

  if (category !== 'huge') {
    return { blocked: false, sizeCategory: category }
  }

  const normalizedSql = sql.trim().toUpperCase()

  if (!normalizedSql.startsWith('SELECT')) {
    return { blocked: false, sizeCategory: category }
  }

  const hasWhere = /\bWHERE\b/i.test(sql)
  const hasLimit = /\bLIMIT\b/i.test(sql)

  if (hasWhere || hasLimit) {
    return { blocked: false, sizeCategory: category }
  }

  return {
    blocked: true,
    sizeCategory: category,
    reason: `Table has ~${tableSizeInfo.estimatedRowCount.toLocaleString()} rows (huge). Add WHERE or LIMIT clause, or use --no-limit to override.`
  }
}

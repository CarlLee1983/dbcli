import { globMatches } from '@/utils/glob'
import type { RedisMaskRule } from '@/types/blacklist'

const REDACTED = '[REDACTED]'

/** Commands whose reply rows we mask. Key is always args[0]. */
const MASKABLE = new Set(['GET', 'GETRANGE', 'HGETALL', 'HGET', 'HMGET', 'HVALS'])

interface MatchPlan {
  wholeValue: boolean
  fields: Set<string>
}

function planFor(key: string, rules: RedisMaskRule[]): MatchPlan | null {
  const matched = rules.filter((r) => globMatches(r.keyPattern, key))
  if (matched.length === 0) return null
  const wholeValue = matched.some((r) => !r.fields || r.fields.length === 0)
  const fields = new Set(matched.flatMap((r) => r.fields ?? []))
  return { wholeValue, fields }
}

export function maskRedisRows(
  command: string,
  args: string[],
  rows: Record<string, unknown>[],
  rules: RedisMaskRule[]
): Record<string, unknown>[] {
  if (rules.length === 0) return rows
  const head = command.toUpperCase()
  if (!MASKABLE.has(head)) return rows
  const key = args[0]
  if (key === undefined) return rows
  const plan = planFor(key, rules)
  if (!plan) return rows

  if (head === 'GET' || head === 'GETRANGE') {
    if (!plan.wholeValue) return rows
    return rows.map((r) => ({ ...r, value: REDACTED }))
  }

  if (head === 'HGETALL') {
    return rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(row)) {
        out[field] = plan.wholeValue || plan.fields.has(field) ? REDACTED : value
      }
      return out
    })
  }

  if (head === 'HGET') {
    const field = args[1]
    const hit = plan.wholeValue || (field !== undefined && plan.fields.has(field))
    return hit ? rows.map((r) => ({ ...r, value: REDACTED })) : rows
  }

  if (head === 'HMGET') {
    return rows.map((row) => {
      const idx = typeof row.index === 'number' ? row.index : Number(row.index)
      const field = args[1 + idx]
      const hit = plan.wholeValue || (field !== undefined && plan.fields.has(field))
      return hit ? { ...row, value: REDACTED } : row
    })
  }

  if (head === 'HVALS') {
    if (!plan.wholeValue) return rows
    return rows.map((r) => ({ ...r, value: REDACTED }))
  }

  return rows
}

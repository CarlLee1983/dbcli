import { isDrizzleSnapshot } from '@/core/orm-drift/adapters/drizzle'

export type OrmFormat = 'prisma' | 'ddl' | 'json' | 'drizzle'

export function detectOrmFormat(path: string, content: string): OrmFormat {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.prisma')) return 'prisma'
  if (/^\s*model\s+\w+\s*\{/m.test(content)) return 'prisma'

  try {
    const parsed: unknown = JSON.parse(content)
    if (isDrizzleSnapshot(parsed)) return 'drizzle'
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'tables' in parsed
    ) {
      return 'json'
    }
  } catch {
    // Non-JSON content falls through to DDL.
  }

  if (lowerPath.endsWith('.json')) return 'json'
  return 'ddl'
}

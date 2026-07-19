export type OrmFormat = 'prisma' | 'ddl' | 'json'

export function detectOrmFormat(path: string, content: string): OrmFormat {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.prisma')) return 'prisma'
  if (/^\s*model\s+\w+\s*\{/m.test(content)) return 'prisma'
  if (lowerPath.endsWith('.json')) return 'json'

  try {
    const parsed: unknown = JSON.parse(content)
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

  return 'ddl'
}

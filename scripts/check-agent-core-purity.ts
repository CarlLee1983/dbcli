import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../src/agent-core/', import.meta.url)
const rootPath = fileURLToPath(root)
const forbiddenSystem = /\b(postgresql|mysql|mariadb|mongodb|redis|elasticsearch)\b/i
const violations: string[] = []

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]!)
  }
  return specifiers
}

function isForbiddenSpecifier(specifier: string): boolean {
  if (specifier === 'commander' || specifier.startsWith('commander/')) return true
  if (specifier.startsWith('../')) return true
  return /^@\/(?:adapters?|core|utils|types)(?:\/|$)/.test(specifier)
}

export function findAgentCorePurityViolations(source: string, relativePath: string): string[] {
  const found: string[] = []
  if (forbiddenSystem.test(source)) found.push(`${relativePath}: database-specific term`)
  for (const specifier of importSpecifiers(source)) {
    if (isForbiddenSpecifier(specifier)) {
      found.push(`${relativePath}: forbidden dependency '${specifier}'`)
    }
  }
  return [...new Set(found)]
}

if (import.meta.main) {
  for await (const relativePath of new Bun.Glob('**/*.ts').scan({ cwd: rootPath })) {
    const source = await Bun.file(join(rootPath, relativePath)).text()
    violations.push(...findAgentCorePurityViolations(source, relativePath))
  }

  if (violations.length > 0) {
    console.error(
      `agent-core purity check failed:\n${violations.map((item) => `- ${item}`).join('\n')}`
    )
    process.exit(1)
  }

  console.log('agent-core purity check passed')
}

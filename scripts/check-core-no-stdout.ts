/**
 * Gate: modules under src/core must not write to stdout or stderr.
 *
 * Core decides *what* happened; the command layer decides how to say it. Once
 * core cannot reach stdout at all, presentation concerns — colour, ceremony,
 * prompts — are structurally incapable of leaking into the machine-readable
 * output that agents parse. That guarantee is the point; the tidier layering
 * is a side effect.
 *
 * CORE_STDOUT_EXCEPTIONS is a ratchet, not an amnesty. Every entry is a module
 * that predates the rule. The list may shrink and never grow: a contract test
 * fails if an entry no longer violates (clean it, then delete the line), and
 * this script fails if a module outside the list violates.
 *
 * Detection is textual, matching the sibling agent-core purity gate. A write
 * spelled through an alias (`const c = console; c.log(...)`) slips past, and a
 * string literal containing `console.log(` false-positives. Both are accepted:
 * the gate guards against drift by ordinary edits, not against deliberate
 * circumvention, and an AST pass would cost more than that buys.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../src/core/', import.meta.url)
const rootPath = fileURLToPath(root)

/**
 * Modules that wrote to stdout before this gate existed.
 *
 * Paths are relative to src/core, forward-slashed. Only ever remove entries.
 */
export const CORE_STDOUT_EXCEPTIONS: readonly string[] = [
  'atomic-writer.ts',
  'audit/logger.ts',
  'audit/reader.ts',
  'blacklist-manager.ts',
  'blacklist-validator.ts',
  'config.ts',
  'error-recovery.ts',
  'index.ts',
  'mongo/field-masker.ts',
  'query-executor.ts',
  'recovery/emit.ts',
  'repl/repl-engine.ts',
  'saved-queries/loader.ts',
  'schema-cache.ts',
  'schema-index.ts',
  'schema-loader.ts',
]

const WRITERS: ReadonlyArray<{ pattern: RegExp; callee: string }> = [
  { pattern: /\bconsole\s*\.\s*log\s*\(/g, callee: 'console.log' },
  { pattern: /\bconsole\s*\.\s*error\s*\(/g, callee: 'console.error' },
  { pattern: /\bconsole\s*\.\s*warn\s*\(/g, callee: 'console.warn' },
  { pattern: /\bconsole\s*\.\s*info\s*\(/g, callee: 'console.info' },
  { pattern: /\bconsole\s*\.\s*debug\s*\(/g, callee: 'console.debug' },
  { pattern: /\bprocess\s*\.\s*stdout\s*\.\s*write\s*\(/g, callee: 'process.stdout.write' },
  { pattern: /\bprocess\s*\.\s*stderr\s*\.\s*write\s*\(/g, callee: 'process.stderr.write' },
  // Writing the fd directly is the escape route that matters in practice:
  // recovery/emit.ts already does it deliberately, to survive a pipe being
  // truncated by process.exit on Windows. Only literal fds are detectable.
  { pattern: /\bwriteSync\s*\(\s*1\s*,/g, callee: 'writeSync(1)' },
  { pattern: /\bwriteSync\s*\(\s*2\s*,/g, callee: 'writeSync(2)' },
  { pattern: /\bBun\s*\.\s*write\s*\(\s*Bun\s*\.\s*stdout\b/g, callee: 'Bun.write(Bun.stdout)' },
  { pattern: /\bBun\s*\.\s*write\s*\(\s*Bun\s*\.\s*stderr\b/g, callee: 'Bun.write(Bun.stderr)' },
  // An import rather than a write, and the only one worth naming: every
  // function in @/utils/prompts writes a question to a stream and blocks on an
  // answer. `ddl-executor.ts` reached a terminal that way for as long as this
  // gate existed, passing it because the gate reads calls. A core module that
  // needs an answer takes a callback, the way DataExecutor and DDLExecutor do.
  {
    pattern: /\bfrom\s+['"](?:@\/utils\/prompts|(?:\.\.?\/)+utils\/prompts)['"]/g,
    callee: 'promptUser (@/utils/prompts asks on a stream)',
  },
]

/**
 * Report one violation per distinct callee, in the order they first appear.
 */
export function findCoreStdoutViolations(source: string, relativePath: string): string[] {
  const byOffset: Array<{ offset: number; callee: string }> = []

  for (const { pattern, callee } of WRITERS) {
    for (const match of source.matchAll(pattern)) {
      byOffset.push({ offset: match.index, callee })
      break
    }
  }

  return byOffset
    .sort((a, b) => a.offset - b.offset)
    .map(({ callee }) => `${relativePath}: writes to stdout via '${callee}'`)
}

/**
 * Scan src/core, skipping the exception list.
 */
export async function collectCoreStdoutViolations(): Promise<string[]> {
  const exempt = new Set(CORE_STDOUT_EXCEPTIONS)
  const violations: string[] = []

  for await (const scanned of new Bun.Glob('**/*.ts').scan({ cwd: rootPath })) {
    const relativePath = scanned.replaceAll('\\', '/')
    if (exempt.has(relativePath)) continue
    const source = await Bun.file(join(rootPath, relativePath)).text()
    violations.push(...findCoreStdoutViolations(source, relativePath))
  }

  return violations.sort()
}

if (import.meta.main) {
  const violations = await collectCoreStdoutViolations()

  if (violations.length > 0) {
    console.error(
      `core no-stdout check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n\n` +
        'Core returns structured data; the command layer renders it.'
    )
    process.exit(1)
  }

  console.log('core no-stdout check passed')
}

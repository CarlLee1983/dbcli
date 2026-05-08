import { describe, test, expect } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseSavedQuery } from '@/core/saved-queries/parser'

const DIAG_DIR = resolve(import.meta.dir, '../../assets/snippets/diag')

const KNOWN_INTENTS = new Set([
  'perf.slow-query',
  'perf.cache-hit',
  'perf.index-usage',
  'capacity.size',
  'capacity.memory',
  'safety.connections',
  'safety.locks',
  'monitor.cluster-health',
  'monitor.replication',
])

describe('built-in diagnostic snippets', () => {
  test('every file parses, has intent, intent in v1 taxonomy, names unique', async () => {
    const files = (await readdir(DIAG_DIR)).filter((f) => f.endsWith('.sql'))
    expect(files.length).toBe(27)

    const seen = new Set<string>()
    for (const file of files) {
      const full = resolve(DIAG_DIR, file)
      const text = await Bun.file(full).text()
      const out = parseSavedQuery({
        key: '@' + file.replace(/\.sql$/, ''),
        file: full,
        source: 'builtin',
        text,
      })
      expect(out.query.meta.intent, `${file} must declare intent`).toBeDefined()
      expect(
        KNOWN_INTENTS.has(out.query.meta.intent!),
        `${file} intent ${out.query.meta.intent} must be in v1 taxonomy`
      ).toBe(true)
      expect(
        seen.has(out.query.meta.name),
        `${file} name '${out.query.meta.name}' duplicated`
      ).toBe(false)
      seen.add(out.query.meta.name)
    }
  })
})

/**
 * Capability contract — structural gates (DBCLI-PLAT-001/002/003).
 *
 * ADR-0022 makes three claims that only hold if something checks them:
 *
 *   1. the catalog's command paths track the live Commander tree,
 *   2. capability discovery never reaches a database adapter, and
 *   3. `supportsJson` / `supportsEvidence` describe the real command surface.
 *
 * Each is asserted here against the real tree and the real import graph, not
 * against a restatement of the declaration table.
 */
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { buildProgram } from '../../src/program'
import { buildCompletionTree, findCommandPath } from '../../src/core/completion/command-tree'
import { CAPABILITIES, COMMAND_SURFACE } from '../../src/core/capabilities'
import { COMMAND_LOADERS } from '../../src/program-lazy'

const SRC = resolve(import.meta.dir, '../../src')
const tree = buildCompletionTree(buildProgram())

/** Every distinct command path the catalog names. */
const commandPaths = [...new Set(CAPABILITIES.map((capability) => capability.command))].sort()

// ── 1. the catalog cannot drift from the live command tree ───────────────

describe('capability command parity', () => {
  test.each(commandPaths)('`dbcli %s` is a live command', (path) => {
    expect(findCommandPath(tree, path.split(' '))).toBeDefined()
  })

  test('`capabilities` itself is registered on both the eager and lazy paths', () => {
    expect(findCommandPath(tree, ['capabilities'])).toBeDefined()
    expect(findCommandPath(tree, ['capabilities', 'check'])).toBeDefined()
    expect(Object.keys(COMMAND_LOADERS)).toContain('capabilities')
  })

  test('a command declared to support JSON really offers a JSON output option', () => {
    for (const path of COMMAND_SURFACE.jsonCommands) {
      const node = findCommandPath(tree, path.split(' '))
      expect({ path, found: node !== undefined }).toEqual({ path, found: true })

      const offersJson = node!.options.some(
        (option) =>
          option.long === '--json' ||
          (option.long === '--format' && /json/i.test(option.description))
      )
      expect({ path, offersJson }).toEqual({ path, offersJson: true })
    }
  })

  test('the declared JSON surface is exactly what the live tree offers', () => {
    // Both directions. A `--format json` added to `migrate` later must not
    // leave the catalog quietly saying it has none.
    const derived = new Set<string>()
    for (const path of commandPaths) {
      const node = findCommandPath(tree, path.split(' '))
      if (!node) continue
      const offersJson = node.options.some(
        (option) =>
          option.long === '--json' ||
          (option.long === '--format' && /json/i.test(option.description))
      )
      if (offersJson) derived.add(path)
    }
    const declared = new Set(
      [...COMMAND_SURFACE.jsonCommands].filter((p) => commandPaths.includes(p))
    )
    expect([...declared].sort()).toEqual([...derived].sort())
  })

  test('supportsJson on a capability matches its command', () => {
    for (const capability of CAPABILITIES) {
      expect({ id: capability.id, json: capability.supportsJson }).toEqual({
        id: capability.id,
        json: COMMAND_SURFACE.jsonCommands.has(capability.command),
      })
    }
  })
})

// ── 2. discovery never reaches a database adapter ────────────────────────

/**
 * Walk the static import graph from an entry module, staying inside `src/`.
 *
 * Textual, matching the sibling purity gates: a dynamic import built from a
 * variable is invisible here. That is accepted for the same reason it is
 * accepted there — this guards against drift by ordinary edits, not against
 * deliberate circumvention — and the capability modules contain no dynamic
 * imports at all, which this test also asserts.
 */
async function importGraph(entry: string): Promise<Set<string>> {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)

    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }

    const specifiers = [
      ...source.matchAll(
        /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
      ),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]!)

    for (const specifier of specifiers) {
      // Never traverse the registration roots. `completion` imports the whole
      // command tree by design, so following that edge would report every
      // command as depending on every other one — a fact about registration,
      // not about what this command does.
      if (/^(@\/)?\.{0,2}\/?program(-lazy|-root)?$/.test(specifier)) continue

      let target: string | undefined
      if (specifier.startsWith('@/')) target = join(SRC, specifier.slice(2))
      else if (specifier.startsWith('.')) target = resolve(dirname(file), specifier)
      if (!target) continue

      for (const candidate of [`${target}.ts`, join(target, 'index.ts'), target]) {
        if (await Bun.file(candidate).exists()) {
          queue.push(candidate)
          break
        }
      }
    }
  }
  return seen
}

const ADAPTER_MODULES = /\/src\/adapters\/(?!types\.ts$|capabilities\.ts$)/

describe('capability discovery stays offline', () => {
  test('the capability core loads no database adapter', async () => {
    const graph = await importGraph(join(SRC, 'core/capabilities/index.ts'))
    const adapters = [...graph].filter((file) => ADAPTER_MODULES.test(file))
    expect(adapters).toEqual([])
  })

  test('the capability core imports only the two type-level adapter modules', async () => {
    const graph = await importGraph(join(SRC, 'core/capabilities/index.ts'))
    const fromAdapters = [...graph]
      .filter((file) => file.includes('/src/adapters/'))
      .map((file) => file.slice(file.indexOf('/src/adapters/')))
      .sort()
    expect(fromAdapters).toEqual(['/src/adapters/capabilities.ts', '/src/adapters/types.ts'])
  })

  test('the capability core does not read the filesystem, env or process', async () => {
    const graph = await importGraph(join(SRC, 'core/capabilities/index.ts'))
    for (const file of graph) {
      if (!file.includes('/src/core/capabilities/')) continue
      const source = await readFile(file, 'utf8')
      expect({ file, hit: /\bprocess\s*\.\s*env\b/.test(source) }).toEqual({ file, hit: false })
      expect({ file, hit: /\bBun\s*\.\s*file\s*\(/.test(source) }).toEqual({ file, hit: false })
      expect({ file, hit: /from ['"]node:fs/.test(source) }).toEqual({ file, hit: false })
      expect({ file, hit: /\bimport\s*\(/.test(source) }).toEqual({ file, hit: false })
    }
  })

  test('a capability claiming no connection has a command that loads no adapter', async () => {
    // Only this direction is checked. A false `requiresConnection` would tell a
    // Skill it can run offline when it cannot, which is the failure that costs
    // something; a conservative `true` merely under-promises.
    for (const capability of CAPABILITIES) {
      if (capability.requiresConnection) continue
      const entry = join(SRC, `commands/${capability.command.split(' ')[0]}.ts`)
      if (!(await Bun.file(entry).exists())) continue

      const graph = await importGraph(entry)
      const adapters = [...graph]
        .filter((file) => ADAPTER_MODULES.test(file))
        .map((file) => file.slice(file.indexOf('/src/adapters/')))
      expect({ id: capability.id, adapters }).toEqual({ id: capability.id, adapters: [] })
    }
  })

  test('the capabilities command never constructs a database connection', async () => {
    const graph = await importGraph(join(SRC, 'commands/capabilities.ts'))
    const connectionFactories = [...graph].filter((file) =>
      /\/src\/adapters\/(index|factory|postgresql|mysql|mongo|redis|elasticsearch)/.test(file)
    )
    expect(connectionFactories).toEqual([])
  })
})

// ── 3. evidence claims track the real evidence subsystem ─────────────────

describe('capability evidence parity', () => {
  test('no v1 capability claims evidence support', () => {
    // The evidence receipt is emitted by `assert`, `verify` and `evidence`,
    // none of which the v1 catalog covers (ADR-0022). A `true` here without a
    // corresponding receipt would be a promise nothing keeps.
    expect(COMMAND_SURFACE.evidenceCommands.size).toBe(0)
    expect(CAPABILITIES.every((capability) => !capability.supportsEvidence)).toBe(true)
  })

  test('no catalogued command reaches the evidence receipt subsystem', async () => {
    for (const path of commandPaths) {
      const entry = join(SRC, `commands/${path.split(' ')[0]}.ts`)
      if (!(await Bun.file(entry).exists())) continue
      const graph = await importGraph(entry)
      const emitsReceipt = [...graph].some((file) => file.includes('/src/core/evidence-receipt/'))
      expect({ path, emitsReceipt }).toEqual({ path, emitsReceipt: false })
    }
  })
})

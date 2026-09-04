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

/** Forward-slash form of a path, so the `/src/...` filters below hold on Windows too. */
const toPosix = (file: string): string => file.replaceAll('\\', '/')

const SRC = resolve(import.meta.dir, '../../src')
const tree = buildCompletionTree(buildProgram())

/**
 * The module a command path is implemented in.
 *
 * Not `commands/<name>.ts`. That assumption held for every command the v1
 * catalog covered and quietly stopped holding when DBCLI-PLAT-011 added
 * `password` and `contract`, whose modules are `credential.ts` and
 * `contracts.ts`: the file lookup missed, the checks below saw no source, and
 * "this command writes no configuration" came back true for the command whose
 * entire purpose is writing a credential. A miss that reads as a pass is worse
 * than a miss that errors, so the mapping is read from the one place that
 * records it — the lazy loader's `import('./commands/<module>')` — and a path
 * with no module at all is a failure, not a skip.
 */
const LAZY_MODULES: ReadonlyMap<string, string> = new Map(
  [
    ...(await readFile(join(SRC, 'program-lazy.ts'), 'utf8')).matchAll(
      /^\s{2}'?([a-z-]+)'?:\s*async[^\n]*\n\s*const \{[^}]*\} = await import\('\.\/commands\/([\w-]+)'\)/gm
    ),
  ].map(([, command, module]) => [command as string, module as string])
)

async function commandEntry(path: string): Promise<string> {
  const top = path.split(' ')[0] as string
  const module = LAZY_MODULES.get(top) ?? top
  const entry = join(SRC, `commands/${module}.ts`)
  if (!(await Bun.file(entry).exists())) {
    throw new Error(`no module found for \`dbcli ${path}\` (looked for commands/${module}.ts)`)
  }
  return entry
}

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
    const file = toPosix(queue.pop()!)
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

/**
 * The config-writing entry points, every one of which sits behind
 * `assertConfigMutationApproved()`.
 *
 * Detected as calls in the command layer rather than as graph reachability:
 * `src/core/config.ts` holds both `read` and `write`, so *reaching* the guard
 * says only that a command reads configuration — `audit clear` reaches it and
 * mutates nothing.
 */
const CONFIG_MUTATORS = [
  'configModule.write',
  'writeV2Config',
  'setConnectionPassword',
  'writeProjectBinding',
  'patchConnectionSchema',
]

/**
 * Commands that write configuration incidentally rather than as their purpose.
 *
 * Empty, and that is the finding rather than an absence of one. `schema` was
 * the single entry: it persisted the discovered schema through
 * `configModule.write`, which is behind the agent-mode guard, so
 * `capabilities check` reported `schema.read` available while the command
 * exited 1 under `DBCLI_AGENT_MODE=1`. The exemption existed to hold that
 * disclosed contradiction in view until DBCLI-PLAT-012 removed its cause: the
 * cache now goes through `persistSchemaCache`, which writes the cache fields
 * and nothing else and is not a configuration mutation at all.
 *
 * Listing them here rather than skipping them silently means adding a
 * capability on such a command forces the decision back into view. Re-adding an
 * entry is that decision, not a refactor.
 */
const INCIDENTAL_CONFIG_WRITERS = new Set<string>()

async function commandWritesConfig(commandPath: string): Promise<boolean> {
  const entry = await commandEntry(commandPath)

  const graph = [...(await importGraph(entry))].filter((file) => file.includes('/src/commands/'))
  for (const file of graph) {
    const source = await readFile(file, 'utf8')
    if (CONFIG_MUTATORS.some((call) => source.includes(`${call}(`))) return true
  }
  return false
}

describe('capability configuration-mutation parity', () => {
  test('a capability claiming to mutate configuration really does write it', async () => {
    // The direction that matters. A fabricated `true` would make
    // `capabilities check` refuse something that would in fact have worked.
    for (const capability of CAPABILITIES) {
      if (!capability.mutatesConfiguration) continue
      const writes = await commandWritesConfig(capability.command)
      expect({ id: capability.id, writes }).toEqual({ id: capability.id, writes: true })
    }
  })

  test('a capability on a command that writes no configuration never claims it does', async () => {
    for (const capability of CAPABILITIES) {
      if (INCIDENTAL_CONFIG_WRITERS.has(capability.command)) continue
      if (await commandWritesConfig(capability.command)) continue
      expect({ id: capability.id, mutates: capability.mutatesConfiguration }).toEqual({
        id: capability.id,
        mutates: false,
      })
    }
  })

  test('the incidental-writer list names only commands that really write', async () => {
    // Stops the escape hatch above from silently covering a command that no
    // longer writes at all, which would turn it into an unchecked exemption.
    for (const command of INCIDENTAL_CONFIG_WRITERS) {
      expect({ command, writes: await commandWritesConfig(command) }).toEqual({
        command,
        writes: true,
      })
    }
  })

  test('every listed mutator really is behind the agent-mode guard', async () => {
    // Stops the mutator list going stale: an entry that stopped enforcing the
    // boundary would make the tests above assert the wrong thing while staying
    // green.
    for (const relative of [
      'core/config.ts',
      'core/config-v2.ts',
      'core/connection-credential.ts',
      'core/config-binding.ts',
    ]) {
      const source = await readFile(join(SRC, relative), 'utf8')
      expect({ relative, guarded: source.includes('assertConfigMutationApproved') }).toEqual({
        relative,
        guarded: true,
      })
    }
  })
})

// ── 3. evidence claims track the real evidence subsystem ─────────────────

/**
 * The modules that produce a durable receipt of what a command did.
 *
 * Until DBCLI-PLAT-011 this pair of tests asserted the opposite — that the
 * catalog claimed no evidence anywhere — because the v1 catalog did not cover
 * `assert`, `verify` or `evidence`, the three commands that write one. That was
 * true of v1 and is exactly the kind of assertion that goes stale silently, so
 * it is replaced by the parity it was standing in for: what the catalog claims
 * equals what the import graphs reach, in both directions.
 */
const EVIDENCE_WRITERS = ['writeVerificationArtifact', 'writeEvidenceReceipt', 'writeEvidencePack']

describe('capability evidence parity', () => {
  test('the declared evidence surface is exactly what the command graphs reach', async () => {
    // Reaching an evidence module is not writing one: `insert`, `query` and a
    // dozen others pull the receipt *types* in transitively. What a caller is
    // promised by `supportsEvidence` is that a receipt gets written, so the
    // check is the writer call itself, in the command layer — the same shape
    // `commandWritesConfig` uses one section above.
    const derived = new Set<string>()
    for (const path of commandPaths) {
      const graph = [...(await importGraph(await commandEntry(path)))].filter((file) =>
        file.includes('/src/commands/')
      )
      for (const file of graph) {
        const source = await readFile(file, 'utf8')
        if (EVIDENCE_WRITERS.some((call) => source.includes(`${call}(`))) {
          derived.add(path)
          break
        }
      }
    }
    expect([...COMMAND_SURFACE.evidenceCommands].sort()).toEqual([...derived].sort())
  })

  test('supportsEvidence on a capability matches its command', () => {
    for (const capability of CAPABILITIES) {
      expect({ id: capability.id, evidence: capability.supportsEvidence }).toEqual({
        id: capability.id,
        evidence: COMMAND_SURFACE.evidenceCommands.has(capability.command),
      })
    }
  })
})

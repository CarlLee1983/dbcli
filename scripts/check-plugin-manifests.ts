// Every shipped manifest states a version, and `package.json` is the only place
// that version is decided.
//
// This exists because four of them said `1.51.2` while the package said
// `3.0.0`. Nothing failed: no test read them, no check compared them, and the
// number a marketplace shows a user drifted two major versions behind the code
// it installs. Hand-maintained duplicates of a number drift; the only question
// is whether anything notices.
//
// Scope is deliberately narrow — the identity fields a stale manifest gets
// wrong (version, name), the paths a manifest promises (skills, context file,
// logo), and the root/portable copies agreeing with each other. Run with
// `--write` to rewrite the versions rather than report them.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const PACKAGE_NAME = 'dbcli-agent'

type Json = Record<string, unknown>

const read = (path: string): Json => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Json

/**
 * A manifest and what it promises.
 *
 * `pluginRoot` is the directory a relative path inside the manifest resolves
 * against — the plugin root, which is the manifest directory's parent, not the
 * manifest directory itself.
 */
interface ManifestSpec {
  path: string
  /** Paths the manifest names, relative to the plugin root. */
  entries?: readonly { field: string; kind: 'dir' | 'file'; mustContain?: string }[]
}

const MANIFESTS: readonly ManifestSpec[] = [
  { path: '.claude-plugin/plugin.json' },
  {
    path: '.codex-plugin/plugin.json',
    entries: [{ field: 'skills', kind: 'dir', mustContain: 'dbcli/SKILL.md' }],
  },
  {
    path: '.cursor-plugin/plugin.json',
    entries: [
      { field: 'skills', kind: 'dir', mustContain: 'dbcli/SKILL.md' },
      { field: 'logo', kind: 'file' },
    ],
  },
  { path: 'gemini-extension.json', entries: [{ field: 'contextFileName', kind: 'file' }] },
  {
    path: 'plugins/dbcli-agent/.codex-plugin/plugin.json',
    entries: [{ field: 'skills', kind: 'dir', mustContain: 'dbcli/SKILL.md' }],
  },
]

/**
 * Manifests that exist twice: once at the repo root for marketplace installs,
 * once inside the portable plugin directory. Only these fields have to agree —
 * `interface.websiteURL` is legitimately root-only.
 */
const PAIRED_COPIES: readonly { root: string; portable: string; fields: readonly string[] }[] = [
  {
    root: '.codex-plugin/plugin.json',
    portable: 'plugins/dbcli-agent/.codex-plugin/plugin.json',
    fields: ['name', 'version', 'description', 'license', 'skills'],
  },
]

const problems: string[] = []
const fixes: string[] = []
const write = process.argv.includes('--write')

const pkg = read('package.json')
const expectedVersion = String(pkg.version)

function pluginRootOf(manifestPath: string): string {
  // `.codex-plugin/plugin.json` → repo root; `plugins/x/.codex-plugin/…` → `plugins/x`.
  // A manifest sitting at the repo root (gemini-extension.json) is its own root.
  const dir = dirname(manifestPath)
  return dir === '.' ? '' : dirname(dir) === '.' ? '' : dirname(dir)
}

for (const spec of MANIFESTS) {
  if (!existsSync(join(ROOT, spec.path))) {
    problems.push(`${spec.path}: manifest is missing`)
    continue
  }
  const manifest = read(spec.path)

  if (manifest.name !== PACKAGE_NAME) {
    problems.push(
      `${spec.path}: name is ${JSON.stringify(manifest.name)}, expected "${PACKAGE_NAME}"`
    )
  }

  if (manifest.version !== expectedVersion) {
    if (write) {
      const source = readFileSync(join(ROOT, spec.path), 'utf8')
      const updated = source.replace(
        /("version"\s*:\s*)"[^"]*"/,
        `$1${JSON.stringify(expectedVersion)}`
      )
      if (updated === source) {
        problems.push(`${spec.path}: could not rewrite the version field`)
      } else {
        writeFileSync(join(ROOT, spec.path), updated)
        fixes.push(`${spec.path}: version → ${expectedVersion}`)
      }
    } else {
      problems.push(
        `${spec.path}: version is ${JSON.stringify(manifest.version)}, package.json says "${expectedVersion}"`
      )
    }
  }

  const pluginRoot = pluginRootOf(spec.path)
  for (const entry of spec.entries ?? []) {
    const declared = manifest[entry.field]
    if (typeof declared !== 'string' || declared.length === 0) {
      problems.push(`${spec.path}: ${entry.field} is missing`)
      continue
    }
    const target = join(ROOT, pluginRoot, declared)
    if (!existsSync(target)) {
      problems.push(`${spec.path}: ${entry.field} points at ${declared}, which does not exist`)
      continue
    }
    if (entry.mustContain && !existsSync(join(target, entry.mustContain))) {
      problems.push(`${spec.path}: ${declared} does not contain ${entry.mustContain}`)
    }
  }
}

for (const pair of PAIRED_COPIES) {
  if (!existsSync(join(ROOT, pair.root)) || !existsSync(join(ROOT, pair.portable))) continue
  const root = read(pair.root)
  const portable = read(pair.portable)
  for (const field of pair.fields) {
    if (JSON.stringify(root[field]) !== JSON.stringify(portable[field])) {
      problems.push(
        `${pair.portable}: ${field} differs from ${pair.root} (${JSON.stringify(portable[field])} vs ${JSON.stringify(root[field])})`
      )
    }
  }
}

// The marketplace listing names the plugin it installs; a rename that misses it
// points users at a plugin that is not there.
const MARKETPLACE = '.agents/plugins/marketplace.json'
if (existsSync(join(ROOT, MARKETPLACE))) {
  const marketplace = read(MARKETPLACE)
  const listed = (marketplace.plugins as { name?: unknown }[] | undefined) ?? []
  if (!listed.some((plugin) => plugin.name === PACKAGE_NAME)) {
    problems.push(`${MARKETPLACE}: does not list a plugin named "${PACKAGE_NAME}"`)
  }
}

// SECURITY.md states which major line gets fixes. It said 1.x while the package
// said 3.0.0, which is a security document making a false promise — cheap to
// check here, where the package version is already loaded.
const SECURITY = 'SECURITY.md'
const currentMajor = expectedVersion.split('.')[0]
if (existsSync(join(ROOT, SECURITY))) {
  const security = readFileSync(join(ROOT, SECURITY), 'utf8')
  const supported = [...security.matchAll(/^\|\s*\*\*(\d+)\.x\*\*\s*\|(.*)$/gm)]
    .filter(([, , status]) => /:white_check_mark:/.test(status!))
    .map(([, major]) => major!)
  if (supported.length === 0) {
    problems.push(`${SECURITY}: no supported "N.x" row is marked with :white_check_mark:`)
  } else if (supported.length > 1 || supported[0] !== currentMajor) {
    problems.push(
      `${SECURITY}: marks ${supported.map((major) => `${major}.x`).join(', ')} supported; package.json is ${expectedVersion}, so only ${currentMajor}.x may be`
    )
  }
}

for (const fix of fixes) console.log(`fixed ${fix}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`drift ${problem}`)
  console.error('Run `bun run manifest:sync` to align manifest versions with package.json.')
  process.exit(1)
}
console.log(`ok ${MANIFESTS.length} plugin manifests match package.json ${expectedVersion}`)

// Verify that `bun run build` produces the same artifacts twice in a row.
//
// It did not (#56). Successive builds of identical source alternated
// dist/cli-runtime.mjs between two sizes ~690KB apart, depending on whether the
// bundler inlined @inquirer/prompts' implementations or tree-shook them away
// behind an intact barrel. The second outcome shipped a CLI whose interactive
// prompts threw on import and silently degraded to plain text.
//
// The fix was to stop bundling that package at all, but the failure mode is
// general: a bundler that is free to make a different call on the next run can
// ship a different product than the one that was tested. This checks the
// property rather than the one package.
//
// Not part of `bun test` — it builds twice, which takes far too long for the
// default suite. Run it in CI, or by hand before a release.

import { $ } from 'bun'

const ARTIFACTS = [
  'dist/cli.mjs',
  'dist/cli-runtime.mjs',
  'dist/core.mjs',
  'dist/agent-core.mjs',
] as const

async function digest(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer()
  const hash = new Bun.CryptoHasher('sha256')
  hash.update(new Uint8Array(bytes))
  return hash.digest('hex')
}

async function buildAndDigest(label: string): Promise<Map<string, string>> {
  console.log(`building (${label})...`)
  await $`bun run build`.quiet()

  const digests = new Map<string, string>()
  for (const artifact of ARTIFACTS) {
    digests.set(artifact, await digest(artifact))
  }
  return digests
}

const first = await buildAndDigest('first')
const second = await buildAndDigest('second')

const drifted = ARTIFACTS.filter((artifact) => first.get(artifact) !== second.get(artifact))

for (const artifact of ARTIFACTS) {
  const stable = !drifted.includes(artifact)
  const mark = stable ? '✓' : '✗'
  console.log(`${mark} ${artifact} ${first.get(artifact)?.slice(0, 16)}`)
  if (!stable) console.log(`    second build: ${second.get(artifact)?.slice(0, 16)}`)
}

if (drifted.length > 0) {
  console.error(
    `\n✗ build is not reproducible: ${drifted.join(', ')} differ between two builds of identical source.\n` +
      '  A bundler free to decide differently on the next run can ship a different product than the one tested (#56).'
  )
  process.exit(1)
}

console.log(`\n✓ build is reproducible: ${ARTIFACTS.length} artifacts identical across two builds`)

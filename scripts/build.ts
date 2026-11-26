/**
 * Cross-platform build script.
 * Bundles the lightweight launcher and full command runtime separately.
 */
import { $ } from 'bun'
import { rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const outfile = 'dist/cli.mjs'

// 0. Build stamp: tests/helpers/ensure-dist.ts reads it to decide whether dist is
// stale. `startedAt` is recorded *before* the first output is written, so a source
// edited while the build runs reads as newer than the stamp and forces another
// build. The stamp is removed up front and rewritten only on success, so a build
// that dies partway (as the macOS CI runner did) leaves no stamp at all.
const stampFile = 'dist/.build-stamp'
const startedAt = Date.now()
rmSync(stampFile, { force: true })
await mkdir('dist', { recursive: true })

// Every file this script produces. Their hashes go into the stamp because mtime
// alone cannot see an output rewritten in place (a git checkout, or a hand edit) —
// a rewrite stamps mtime as "now" while changing the content.
const artifacts = [
  'dist/cli.mjs',
  'dist/cli-runtime.mjs',
  'dist/core.mjs',
  'dist/core.d.ts',
  'dist/agent-core.mjs',
  'dist/agent-core.d.ts',
  'dist/ui-style.css',
  'assets/ui-template.html',
]

// 1-4. Run independent bundle, declaration, and UI builds concurrently.
console.log('Building UI template...')

await Promise.all([
  // 1. Bundle the full runtime separately so `dbcli --version` does not parse it.
  //     @inquirer/prompts is external for correctness, not size: bundling it was
  //     non-deterministic (#56). Successive builds of identical source alternated
  //     between inlining the prompt implementations and tree-shaking them away
  //     behind an intact barrel, so `await import('@inquirer/prompts')` threw and
  //     every interactive prompt silently degraded to its plain-text fallback.
  // Keep whitespace: Bun whitespace minification miscompiles dynamic bun imports as awaitPromise.
  // Syntax and identifier minification keep Zod 4's runtime within the startup byte budget
  // without that rewrite. Preserve function/class names for runtime diagnostics.
  $`bun build ./src/cli-runtime.ts --minify-syntax --minify-identifiers --keep-names --outfile dist/cli-runtime.mjs --target bun --external pg --external mysql2 --external mongodb --external open --external node-sql-parser --external @inquirer/prompts`,

  // 2. Keep the launcher's dynamic runtime path external. In source it resolves to
  // cli-runtime.ts; beside the built launcher Bun resolves cli-runtime.mjs.
  (async () => {
    await $`bun build ./src/cli.ts --outfile ${outfile} --target bun`
    // Prepend shebang (cross-platform, no subshell)
    const content = await Bun.file(outfile).text()
    await Bun.write(outfile, `#!/usr/bin/env bun\n${content}`)
    // chmod +x (no-op on Windows)
    if (process.platform !== 'win32') {
      const { chmodSync } = await import('node:fs')
      chmodSync(outfile, 0o755)
    }
  })(),

  // 3b. Bundle core library (no shebang) for the `./core` subpath export.
  //     Same externals as the CLI so native drivers stay peer-resolved.
  $`bun build ./src/core/public.ts --outfile dist/core.mjs --target bun --external pg --external mysql2 --external mongodb --external open --external node-sql-parser --external @inquirer/prompts`,

  // 3c. Generate a single flat declaration file for the `./core` subpath.
  //     Requires devDep @types/pg: dts-bundle-generator resolves pg types reachable via AdapterFactory.
  //     --export-referenced-types false: export ONLY the barrel's explicit
  //     exports, so referenced types are inlined as non-exported declarations
  //     instead of colliding. Concretely this avoids a duplicate DbcliConfig:
  //     the interface in src/types/index.ts (reachable via @/types) vs the
  //     Zod-inferred type in src/utils/validation.ts that the barrel re-exports.
  $`bunx dts-bundle-generator -o dist/core.d.ts --project tsconfig.json --no-check --export-referenced-types false src/core/public.ts`,

  // 3d. Build the small, framework-free interface shared by agent tools.
  $`bun build ./src/agent-core/public.ts --outfile dist/agent-core.mjs --target bun`,
  $`bunx dts-bundle-generator -o dist/agent-core.d.ts --project tsconfig.json --no-check --export-referenced-types false src/agent-core/public.ts`,

  // 4. UI Template Build & Inlining
  (async () => {
    // a. Bundle JS & b. Build CSS with Tailwind in parallel
    // Pin process.env.NODE_ENV at build time so the artifact is independent of
    // caller env (e.g. `bun test` sets NODE_ENV=test, which used to flip
    // Redux/RTK dev branches and break artifact determinism). See issue #2.
    const [uiJs] = await Promise.all([
      Bun.build({
        entrypoints: ['./src/ui-template/src/main.tsx'],
        minify: true,
        target: 'browser',
        define: {
          'process.env.NODE_ENV': '"production"',
        },
      }),
      $`bunx tailwindcss -c ./src/ui-template/tailwind.config.js -i ./src/ui-template/src/index.css -o ./dist/ui-style.css --minify`,
    ])
    if (!uiJs.success) {
      console.error('UI Build failed:', uiJs.logs)
      process.exit(1)
    }
    const jsCode = (await uiJs.outputs[0]?.text()) ?? ''
    const cssCode = await Bun.file('./dist/ui-style.css').text()

    // c. Inline into HTML
    let html = await Bun.file('./src/ui-template/index.html').text()
    html = html.replace('/*DBCLI_CSS*/', () => cssCode)
    html = html.replace('/*DBCLI_JS*/', () => jsCode.replace(/<\/script>/gi, '<\\/script>'))

    // d. Save to assets/ui-template.html
    await Bun.write('assets/ui-template.html', html)

    console.log('UI template built successfully: assets/ui-template.html')
  })(),
])

// 5. Everything above succeeded — record when this build started, which Bun built
// it (a toolchain upgrade changes the output with no input file changing), and what
// each artifact hashes to.
const outputs: Record<string, string> = {}
for (const rel of artifacts) {
  outputs[rel] = Bun.hash(await Bun.file(rel).bytes()).toString(16)
}
await Bun.write(
  stampFile,
  `${JSON.stringify({ startedAt, bunVersion: Bun.version, outputs }, null, 2)}\n`
)

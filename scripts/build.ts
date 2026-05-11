/**
 * Cross-platform build script.
 * Bundles src/cli.ts → dist/cli.mjs with shebang prepended.
 */
import { $ } from 'bun'

const outfile = 'dist/cli.mjs'

// 1. Bundle
await $`bun build ./src/cli.ts --outfile ${outfile} --target bun --external pg --external mysql2 --external mongodb --external open`

// 2. Prepend shebang (cross-platform, no subshell)
const content = await Bun.file(outfile).text()
await Bun.write(outfile, `#!/usr/bin/env bun\n${content}`)

// 3. chmod +x (no-op on Windows)
if (process.platform !== 'win32') {
  const { chmodSync } = await import('node:fs')
  chmodSync(outfile, 0o755)
}

// 4. UI Template Build & Inlining
console.log('Building UI template...')

// Ensure dist exists for temporary CSS
import { mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })

// a. Bundle JS
const uiJs = await Bun.build({
  entrypoints: ['./src/ui-template/src/main.tsx'],
  minify: true,
  target: 'browser',
})
if (!uiJs.success) {
  console.error('UI Build failed:', uiJs.logs)
  process.exit(1)
}
const jsCode = await uiJs.outputs[0]?.text() ?? ''

// b. Build CSS with Tailwind
await $`bunx tailwindcss -c ./src/ui-template/tailwind.config.js -i ./src/ui-template/src/index.css -o ./dist/ui-style.css --minify`
const cssCode = await Bun.file('./dist/ui-style.css').text()

// c. Inline into HTML
let html = await Bun.file('./src/ui-template/index.html').text()
html = html.replace('/*DBCLI_CSS*/', () => cssCode)
html = html.replace('/*DBCLI_JS*/', () => jsCode.replace(/<\/script>/gi, '<\\/script>'))

// d. Save to assets/ui-template.html
await Bun.write('assets/ui-template.html', html)

console.log('UI template built successfully: assets/ui-template.html')

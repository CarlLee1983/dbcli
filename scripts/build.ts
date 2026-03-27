/**
 * Cross-platform build script.
 * Bundles src/cli.ts → dist/cli.mjs with shebang prepended.
 */
import { $ } from 'bun'

const outfile = 'dist/cli.mjs'

// 1. Bundle
await $`bun build ./src/cli.ts --outfile ${outfile} --target bun`

// 2. Prepend shebang (cross-platform, no subshell)
const content = await Bun.file(outfile).text()
await Bun.write(outfile, `#!/usr/bin/env bun\n${content}`)

// 3. chmod +x (no-op on Windows)
if (process.platform !== 'win32') {
  const { chmodSync } = await import('node:fs')
  chmodSync(outfile, 0o755)
}

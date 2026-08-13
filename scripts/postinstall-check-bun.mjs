/**
 * Post-install runtime check.
 *
 * `engines` declares bun only, but npm ignores engine fields it does not know, so an
 * `npm install -g @carllee1983/dbcli` on a machine without Bun succeeds and leaves a
 * `dbcli` on PATH whose `#!/usr/bin/env bun` shebang cannot start. This warns at the
 * moment that happens, which is closer to the user than any README paragraph.
 *
 * Plain Node ESM on purpose: npm runs this with node, not bun. Never fails the install —
 * a warning is the whole point, and a non-zero exit here would break the package.
 */

import { spawnSync } from 'node:child_process'

const BUN_INSTALL_HINT =
  process.platform === 'win32'
    ? 'powershell -c "irm bun.sh/install.ps1 | iex"'
    : 'curl -fsSL https://bun.sh/install | bash'

function bunIsAvailable() {
  if (process.versions.bun) return true
  try {
    const result = spawnSync('bun', ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      shell: process.platform === 'win32',
    })
    return result.status === 0
  } catch {
    return false
  }
}

// npm hides lifecycle-script output unless the script fails (verified on npm 10.9.8:
// a warning printed here is invisible without --foreground-scripts). So a global
// install — the one whose whole purpose is a working `dbcli` on PATH — exits non-zero
// to make the reason visible, and npm rolls the broken executable back. A local install
// stays silent and succeeds: that is the `./agent-core` consumer, who needs no Bun.
const isGlobalInstall = process.env.npm_config_global === 'true'

if (!bunIsAvailable()) {
  const message = [
    '',
    'dbcli: Bun was not found on PATH.',
    '',
    "  dbcli's executable runs under Bun (its shebang is `#!/usr/bin/env bun`), so it",
    '  cannot start until Bun 1.3.3+ is installed:',
    '',
    `    ${BUN_INSTALL_HINT}`,
    '',
    '  Then re-run the install. The ./agent-core subpath export is importable from',
    '  Node without Bun, and installing it as a project dependency does not need this.',
    '',
  ].join('\n')

  if (isGlobalInstall) {
    console.error(message)
    process.exit(1)
  }
  console.warn(message)
}

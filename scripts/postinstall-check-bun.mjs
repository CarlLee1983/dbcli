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

if (!bunIsAvailable()) {
  console.warn(
    [
      '',
      'dbcli: Bun was not found on PATH.',
      '',
      "  The package installed, but dbcli's executable runs under Bun (its shebang is",
      '  `#!/usr/bin/env bun`), so `dbcli` will not start until Bun 1.3.3+ is installed:',
      '',
      `    ${BUN_INSTALL_HINT}`,
      '',
      '  The ./agent-core subpath export is importable from Node without Bun.',
      '',
    ].join('\n')
  )
}

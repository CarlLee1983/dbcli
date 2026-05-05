import { join, resolve } from 'node:path'
import type { SnippetSource } from './types'

export interface SnippetDirs {
  builtinDir: string
  sharedDir: string
  localDir: string
}

/**
 * Builtin snippets ship under `assets/snippets/`, packaged via `files` in
 * package.json. Resolved relative to this module so dev (`bun run src/cli.ts`)
 * and bundled `dist/` both work.
 */
function resolveBuiltinDir(): string {
  // src/core/saved-queries/snippet-paths.ts → ../../../assets/snippets
  return resolve(import.meta.dir, '..', '..', '..', 'assets', 'snippets')
}

export function resolveSnippetDirs(workspaceRoot: string): SnippetDirs {
  return {
    builtinDir: resolveBuiltinDir(),
    sharedDir: join(workspaceRoot, '.dbcli-shared', 'queries'),
    localDir: join(workspaceRoot, '.dbcli', 'queries'),
  }
}

export function snippetKeyToFile(
  workspaceRoot: string,
  key: string,
  source: SnippetSource
): string {
  const rel = key.replace(/^@/, '') + '.sql'
  if (source === 'builtin') return join(resolveBuiltinDir(), rel)
  const dir = source === 'shared' ? '.dbcli-shared/queries' : '.dbcli/queries'
  return join(workspaceRoot, dir, rel)
}

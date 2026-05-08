import { join } from 'node:path'
import { packageAssetPath } from '@/utils/package-root'
import type { SnippetSource } from './types'

export interface SnippetDirs {
  builtinDir: string
  sharedDir: string
  localDir: string
}

/**
 * Builtin snippets ship under `assets/snippets/`, packaged via `files` in
 * package.json. Resolved via the shared package-root walker so both dev mode
 * (`bun run src/cli.ts`) and bundled `dist/cli.mjs` find the right directory.
 */
function resolveBuiltinDir(): string {
  return packageAssetPath('snippets')
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

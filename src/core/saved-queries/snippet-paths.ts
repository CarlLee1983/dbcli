import { join } from 'node:path'
import type { SnippetSource } from './types'

export interface SnippetDirs {
  sharedDir: string
  localDir: string
}

export function resolveSnippetDirs(workspaceRoot: string): SnippetDirs {
  return {
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
  const dir = source === 'shared' ? '.dbcli-shared/queries' : '.dbcli/queries'
  return join(workspaceRoot, dir, rel)
}

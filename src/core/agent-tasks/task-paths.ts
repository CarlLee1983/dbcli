import { join } from 'node:path'
import { packageAssetPath } from '@/utils/package-root'
import type { AgentTaskSource } from './types'

export interface AgentTaskDirs {
  builtinDir: string
  sharedDir: string
  localDir: string
}

function resolveBuiltinDir(): string {
  return packageAssetPath('tasks')
}

export function resolveAgentTaskDirs(workspaceRoot: string): AgentTaskDirs {
  return {
    builtinDir: resolveBuiltinDir(),
    sharedDir: join(workspaceRoot, '.dbcli-shared', 'tasks'),
    localDir: join(workspaceRoot, '.dbcli', 'tasks'),
  }
}

export function taskNameToFile(
  workspaceRoot: string,
  name: string,
  source: AgentTaskSource
): string {
  const rel = name + '.md'
  if (source === 'builtin') return join(resolveBuiltinDir(), rel)
  const dir = source === 'shared' ? '.dbcli-shared/tasks' : '.dbcli/tasks'
  return join(workspaceRoot, dir, rel)
}

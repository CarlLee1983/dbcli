import { join, resolve } from 'node:path'
import type { AgentTaskSource } from './types'

export interface AgentTaskDirs {
  builtinDir: string
  sharedDir: string
  localDir: string
}

function resolveBuiltinDir(): string {
  // src/core/agent-tasks/task-paths.ts → ../../../assets/tasks
  return resolve(import.meta.dir, '..', '..', '..', 'assets', 'tasks')
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

import { createHash } from 'crypto'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'

const BINDING_FILE_NAME = 'config.json'
const DBCLI_HOME_ROOT = join(homedir(), '.config', 'dbcli')

export interface ProjectConfigBinding {
  version: 3
  binding: {
    type: 'home-storage'
    storagePath: string
    projectPath: string
    createdAt: string
  }
}

function isProjectConfigBinding(raw: unknown): raw is ProjectConfigBinding {
  if (typeof raw !== 'object' || raw === null) return false
  const candidate = raw as Partial<ProjectConfigBinding> & {
    binding?: { type?: string; storagePath?: unknown; projectPath?: unknown; createdAt?: unknown }
  }

  return (
    candidate.version === 3 &&
    typeof candidate.binding === 'object' &&
    candidate.binding !== null &&
    candidate.binding.type === 'home-storage' &&
    typeof candidate.binding.storagePath === 'string' &&
    candidate.binding.storagePath.length > 0 &&
    typeof candidate.binding.projectPath === 'string' &&
    candidate.binding.projectPath.length > 0 &&
    typeof candidate.binding.createdAt === 'string' &&
    candidate.binding.createdAt.length > 0
  )
}

export function getDbcliHomeRoot(): string {
  return DBCLI_HOME_ROOT
}

export function getProjectStoragePath(projectPath: string): string {
  const normalizedProjectPath = resolve(projectPath)
  const projectName = basename(normalizedProjectPath) || 'project'
  const hash = createHash('sha1').update(normalizedProjectPath).digest('hex').slice(0, 12)
  return join(getDbcliHomeRoot(), 'projects', `${projectName}-${hash}`)
}

export async function readProjectBinding(
  projectPath: string
): Promise<ProjectConfigBinding | null> {
  const configFile = Bun.file(join(projectPath, BINDING_FILE_NAME))
  if (!(await configFile.exists())) return null

  try {
    const raw = JSON.parse(await configFile.text())
    return isProjectConfigBinding(raw) ? raw : null
  } catch {
    return null
  }
}

export async function resolveConfigStoragePath(path: string): Promise<string> {
  const binding = await readProjectBinding(path)
  return binding?.binding.storagePath ?? path
}

export async function writeProjectBinding(
  projectPath: string,
  storagePath: string = getProjectStoragePath(projectPath)
): Promise<ProjectConfigBinding> {
  const binding: ProjectConfigBinding = {
    version: 3,
    binding: {
      type: 'home-storage',
      storagePath,
      projectPath: resolve(projectPath),
      createdAt: new Date().toISOString(),
    },
  }

  await Bun.$`mkdir -p ${projectPath}`
  await Bun.$`mkdir -p ${storagePath}`
  await Bun.file(join(projectPath, BINDING_FILE_NAME)).write(JSON.stringify(binding, null, 2))

  return binding
}

export async function migrateLegacyProjectEnvLocal(
  projectPath: string,
  storagePath: string = getProjectStoragePath(projectPath)
): Promise<void> {
  const projectEnvPath = join(projectPath, '.env.local')
  const projectEnvFile = Bun.file(projectEnvPath)
  if (!(await projectEnvFile.exists())) return

  const storageEnvPath = join(storagePath, '.env.local')
  await Bun.$`mkdir -p ${storagePath}`

  if (!(await Bun.file(storageEnvPath).exists())) {
    await Bun.file(storageEnvPath).write(await projectEnvFile.text())
  }

  await Bun.$`rm -f ${projectEnvPath}`
}

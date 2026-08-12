import { createHash } from 'crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { assertConfigMutationApproved } from '@/core/config-mutation-guard'
import {
  assertAgentReadableFile,
  assertBindingIntegrity,
  writeBindingWithIntegrity,
} from '@/core/config-integrity'
import { ConfigError } from '@/utils/errors'

const BINDING_FILE_NAME = 'config.json'

/**
 * Resolve the per-user dbcli root lazily so embedders and tests can provide an
 * isolated config home without reloading the module. `DBCLI_CONFIG_HOME` is a
 * dbcli-specific override; otherwise preserve the existing `~/.config` path.
 */
export function getDbcliConfigHome(): string {
  const configuredHome = process.env.DBCLI_CONFIG_HOME?.trim()
  if (configuredHome) return configuredHome

  return join(process.env.HOME?.trim() || homedir(), '.config', 'dbcli')
}

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
  return getDbcliConfigHome()
}

/** Canonical user-global configuration directory (`~/.config/dbcli`). */
export function getGlobalConfigPath(): string {
  return getDbcliHomeRoot()
}

/** Whether a path points at the canonical user-global configuration directory. */
export function isGlobalConfigPath(path: string): boolean {
  return resolve(path) === resolve(getGlobalConfigPath())
}

export function getProjectStoragePath(projectPath: string): string {
  const normalizedProjectPath = resolve(projectPath)
  const projectName = basename(normalizedProjectPath) || 'project'
  const hash = createHash('sha1').update(normalizedProjectPath).digest('hex').slice(0, 12)
  return join(getDbcliHomeRoot(), 'projects', `${projectName}-${hash}`)
}

/**
 * Process 內的綁定快取。
 *
 * 一次 CLI 執行會沿著十幾條路徑問「這個專案綁到哪個 storage」——每次都要讀檔、
 * 算 SHA-256、比對信任紀錄。同一份檔案在同一個 process 內不會變（唯一的合法
 * 變更來自我們自己的寫入路徑，那裡會清掉快取），所以第二次之後的成本沒有換到
 * 任何保證。
 *
 * 只快取讀取結果，不在寫入時預先填值：寫完立刻重讀一次的成本微不足道，而讓
 * 每個未快取的路徑都真的走過完整性驗證，比省那一次 I/O 值得。快取鍵帶上
 * agent mode，因為它決定驗證的嚴格程度。
 */
const _bindingCache = new Map<string, ProjectConfigBinding | null>()

function bindingCacheKey(projectPath: string): string {
  return `${process.env.DBCLI_AGENT_MODE ?? ''}:${resolve(projectPath)}`
}

/** 讓 process 內的綁定快取失效（寫入路徑與測試使用） */
export function invalidateProjectBindingCache(): void {
  _bindingCache.clear()
}

export async function readProjectBinding(
  projectPath: string
): Promise<ProjectConfigBinding | null> {
  const cacheKey = bindingCacheKey(projectPath)
  if (_bindingCache.has(cacheKey)) return _bindingCache.get(cacheKey) ?? null

  const binding = await readProjectBindingUncached(projectPath)
  _bindingCache.set(cacheKey, binding)
  return binding
}

async function readProjectBindingUncached(
  projectPath: string
): Promise<ProjectConfigBinding | null> {
  const configFile = Bun.file(join(projectPath, BINDING_FILE_NAME))
  if (!(await configFile.exists())) return null

  try {
    await assertAgentReadableFile(join(projectPath, BINDING_FILE_NAME), 'project binding')
    const content = await configFile.text()
    const raw = JSON.parse(content)
    if (!isProjectConfigBinding(raw)) return null
    await assertBindingIntegrity(projectPath, content, { requireRecord: true })
    return raw
  } catch (error) {
    // 驗證失敗不進快取：下一次呼叫該重新面對同一個錯誤，而不是拿到一個
    // 「這裡沒有綁定」的偽陰性
    if (error instanceof ConfigError) throw error
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
  assertConfigMutationApproved()
  const binding: ProjectConfigBinding = {
    version: 3,
    binding: {
      type: 'home-storage',
      storagePath,
      projectPath: resolve(projectPath),
      createdAt: new Date().toISOString(),
    },
  }

  await mkdir(projectPath, { recursive: true })
  await mkdir(storagePath, { recursive: true })
  const content = JSON.stringify(binding, null, 2)
  await writeBindingWithIntegrity(projectPath, content)
  invalidateProjectBindingCache()

  return binding
}

export async function migrateLegacyProjectEnvLocal(
  projectPath: string,
  storagePath: string = getProjectStoragePath(projectPath)
): Promise<void> {
  assertConfigMutationApproved()
  const projectEnvPath = join(projectPath, '.env.local')
  const projectEnvFile = Bun.file(projectEnvPath)
  if (!(await projectEnvFile.exists())) return

  const storageEnvPath = join(storagePath, '.env.local')
  await mkdir(storagePath, { recursive: true })

  if (!(await Bun.file(storageEnvPath).exists())) {
    await Bun.file(storageEnvPath).write(await projectEnvFile.text())
  }

  await unlink(projectEnvPath)
}

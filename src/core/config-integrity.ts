import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ConfigError } from '@/utils/errors'

const INTEGRITY_FILE = '.config-integrity.json'

interface ConfigIntegrityRecord {
  version: 1
  configSha256: string
  updatedAt: string
  targetPath?: string
}

function integrityPath(storagePath: string, recordName = INTEGRITY_FILE): string {
  return join(storagePath, recordName)
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function protectedPath(storagePath: string, protectedFileName: string): string {
  return resolve(join(storagePath, protectedFileName))
}

/**
 * Optional host-protected trust anchor.  A launcher can point this at a
 * read-only directory outside the agent workspace; each config/binding gets a
 * detached record keyed by the canonical protected path.  Without this
 * anchor, the colocated record still detects ordinary out-of-band edits but
 * cannot distinguish a hostile process with the same OS identity.
 */
function anchorPathFor(protectedFilePath: string): string | null {
  const anchorDirectory = process.env.DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR?.trim()
  if (!anchorDirectory) return null
  const key = createHash('sha256').update(protectedFilePath).digest('hex')
  return join(resolve(anchorDirectory), `${key}.json`)
}

async function bestEffortSecureMode(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode)
  } catch {
    // Windows and filesystems without POSIX mode bits are still protected by
    // the content hash; the mode check below is best effort there.
  }
}

/**
 * Check the file type and mode before an agent-mode caller reads its contents.
 * This keeps FIFOs, devices, symlinks, and broadly writable files outside the
 * trust boundary instead of reading them and validating only afterwards.
 */
export async function assertAgentReadableFile(
  path: string,
  description = 'config'
): Promise<void> {
  if (process.env.DBCLI_AGENT_MODE !== '1') return
  try {
    const fileStat = await lstat(path)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new ConfigError(
        `Agent mode refuses a non-regular ${description} file: ${path}. Run the human/admin setup workflow to provision it.`
      )
    }
    if ((fileStat.mode & 0o022) !== 0) {
      throw new ConfigError(
        `Agent mode refuses a group/world-writable config: ${path}. Run the human/admin setup workflow to secure it.`
      )
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError(`Agent mode refuses an unreadable ${description} file: ${path}`)
  }
}

async function writeIntegrityRecord(
  storagePath: string,
  configContent: string,
  recordName: string,
  protectedFileName: string
): Promise<void> {
  await mkdir(storagePath, { recursive: true })
  const path = integrityPath(storagePath, recordName)
  const protectedFilePath = protectedPath(storagePath, protectedFileName)
  const temporary = `${path}.tmp-${process.pid}`
  const record: ConfigIntegrityRecord = {
    version: 1,
    configSha256: hash(configContent),
    updatedAt: new Date().toISOString(),
    targetPath: protectedFilePath,
  }
  await Bun.write(temporary, JSON.stringify(record, null, 2))
  await rename(temporary, path)

  const anchorPath = anchorPathFor(protectedFilePath)
  if (anchorPath) {
    await mkdir(dirname(anchorPath), { recursive: true })
    const anchorTemporary = `${anchorPath}.tmp-${process.pid}`
    await Bun.write(anchorTemporary, JSON.stringify(record, null, 2))
    await rename(anchorTemporary, anchorPath)
    await bestEffortSecureMode(dirname(anchorPath), 0o700)
    await bestEffortSecureMode(anchorPath, 0o600)
  }

  // Connection configuration and its integrity record contain security
  // metadata. Keep them private on POSIX filesystems where possible.
  await bestEffortSecureMode(storagePath, 0o700)
  await bestEffortSecureMode(join(storagePath, protectedFileName), 0o600)
  await bestEffortSecureMode(path, 0o600)
}

/** Persist a content hash alongside a config after a trusted CLI write. */
export async function writeConfigIntegrity(storagePath: string, configContent: string): Promise<void> {
  await writeIntegrityRecord(storagePath, configContent, INTEGRITY_FILE, 'config.json')
}

/** Persist a content hash alongside a project binding after a trusted CLI write. */
export async function writeBindingIntegrity(
  projectPath: string,
  bindingContent: string
): Promise<void> {
  await writeIntegrityRecord(projectPath, bindingContent, '.binding-integrity.json', 'config.json')
}

/**
 * In agent mode, reject a changed config, an unsafe file, or a missing trust
 * record.  A detached host-protected anchor may be configured through
 * DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR; when present it is authoritative even if
 * the colocated record is replaced or deleted.
 */
async function assertIntegrityRecord(
  storagePath: string,
  configContent: string,
  recordName: string,
  protectedFileName: string,
  description: string,
  options: { requireRecord?: boolean } = {}
): Promise<void> {
  if (process.env.DBCLI_AGENT_MODE !== '1') return

  const configPath = protectedPath(storagePath, protectedFileName)
  await assertAgentReadableFile(configPath, description)

  const verifyRecord = async (path: string, label: string): Promise<void> => {
    const file = Bun.file(path)
    if (!(await file.exists())) {
      throw new ConfigError(`Agent mode refuses a missing ${label}: ${path}`)
    }
    let record: ConfigIntegrityRecord
    try {
      await assertAgentReadableFile(path, label)
      record = (await file.json()) as ConfigIntegrityRecord
    } catch (error) {
      if (error instanceof ConfigError) throw error
      throw new ConfigError(`Agent mode refuses an unreadable ${label}: ${path}`)
    }
    if (
      record.version !== 1 ||
      typeof record.configSha256 !== 'string' ||
      record.configSha256 !== hash(configContent) ||
      (record.targetPath !== undefined && record.targetPath !== configPath)
    ) {
      throw new ConfigError(
        `Agent mode detected direct ${description} tampering or an out-of-band edit: ${configPath}`
      )
    }
  }

  const anchorPath = anchorPathFor(configPath)
  if (anchorPath) await verifyRecord(anchorPath, 'detached config integrity anchor')

  const localPath = integrityPath(storagePath, recordName)
  const localExists = await Bun.file(localPath).exists()
  if (localExists) {
    await verifyRecord(localPath, 'config integrity record')
  } else if (options.requireRecord && !anchorPath) {
    throw new ConfigError(`Agent mode refuses a missing config integrity record: ${localPath}`)
  }
}

export async function assertConfigIntegrity(
  storagePath: string,
  configContent: string,
  options?: { requireRecord?: boolean }
): Promise<void> {
  await assertIntegrityRecord(
    storagePath,
    configContent,
    INTEGRITY_FILE,
    'config.json',
    'config',
    options
  )
}

export async function assertBindingIntegrity(
  projectPath: string,
  bindingContent: string,
  options?: { requireRecord?: boolean }
): Promise<void> {
  await assertIntegrityRecord(
    projectPath,
    bindingContent,
    '.binding-integrity.json',
    'config.json',
    'project binding',
    options
  )
}

export function configIntegrityPathForTest(storagePath: string): string {
  return integrityPath(storagePath)
}

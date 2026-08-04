import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, rename, unlink } from 'node:fs/promises'
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
 * Whether a stat() mode should be refused as group/world-writable.
 *
 * The lower mode bits only mean anything where the filesystem actually stores
 * them. Windows reports a synthetic 0o666 for every writable file (0o444 once
 * the read-only bit is set), so an unconditional check refuses even the config
 * dbcli has just written itself. Confidentiality there rests on the ACL the OS
 * applies to the user profile; tamper detection is unaffected either way,
 * because it is the content hash — not the mode — that the integrity record
 * verifies.
 */
export function refusesGroupOrWorldWritable(
  mode: number,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform === 'win32') return false
  return (mode & 0o022) !== 0
}

/**
 * Check the file type and mode before an agent-mode caller reads its contents.
 * This keeps FIFOs, devices, symlinks, and broadly writable files outside the
 * trust boundary instead of reading them and validating only afterwards.
 */
export async function assertAgentReadableFile(path: string, description = 'config'): Promise<void> {
  if (process.env.DBCLI_AGENT_MODE !== '1') return
  try {
    const fileStat = await lstat(path)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new ConfigError(
        `Agent mode refuses a non-regular ${description} file: ${path}. Run the human/admin setup workflow to provision it.`
      )
    }
    if (refusesGroupOrWorldWritable(fileStat.mode)) {
      throw new ConfigError(
        `Agent mode refuses a group/world-writable config: ${path}. Run the human/admin setup workflow to secure it.`
      )
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError(`Agent mode refuses an unreadable ${description} file: ${path}`)
  }
}

async function writeProtectedFileWithIntegrity(
  storagePath: string,
  protectedFileName: string,
  protectedContent: string,
  recordName: string
): Promise<void> {
  await mkdir(storagePath, { recursive: true })

  const protectedFilePath = protectedPath(storagePath, protectedFileName)
  const localPath = integrityPath(storagePath, recordName)
  const anchorPath = anchorPathFor(protectedFilePath)
  const record: ConfigIntegrityRecord = {
    version: 1,
    configSha256: hash(protectedContent),
    updatedAt: new Date().toISOString(),
    targetPath: protectedFilePath,
  }
  const recordContent = JSON.stringify(record, null, 2)
  const suffix = `${process.pid}-${randomUUID()}`
  const protectedTemporary = `${protectedFilePath}.tmp-${suffix}`
  const localTemporary = `${localPath}.tmp-${suffix}`
  const anchorTemporary = anchorPath ? `${anchorPath}.tmp-${suffix}` : null
  const published: FileSnapshot[] = []

  try {
    const [protectedSnapshot, localSnapshot, anchorSnapshot] = await Promise.all([
      snapshot(protectedFilePath),
      snapshot(localPath),
      anchorPath ? snapshot(anchorPath) : Promise.resolve(null),
    ])

    await Bun.write(protectedTemporary, protectedContent)
    await Bun.write(localTemporary, recordContent)
    if (anchorPath && anchorTemporary) {
      await mkdir(dirname(anchorPath), { recursive: true })
      await Bun.write(anchorTemporary, recordContent)
    }

    const publish = async (temporary: string, previous: FileSnapshot): Promise<void> => {
      await rename(temporary, previous.path)
      published.push(previous)
    }

    // Publish the detached record first: an anchor staging/publish failure must
    // leave the existing protected file and colocated record untouched.
    if (anchorTemporary && anchorPath) {
      await publish(anchorTemporary, anchorSnapshot ?? { path: anchorPath, content: null })
    }
    await publish(localTemporary, localSnapshot)
    await publish(protectedTemporary, protectedSnapshot)
  } catch (error) {
    for (const publishedFile of published.reverse()) {
      await restore(publishedFile).catch(() => undefined)
    }
    throw error
  } finally {
    await unlink(protectedTemporary).catch(() => undefined)
    await unlink(localTemporary).catch(() => undefined)
    if (anchorTemporary) await unlink(anchorTemporary).catch(() => undefined)
  }

  if (anchorPath) {
    await bestEffortSecureMode(dirname(anchorPath), 0o700)
    await bestEffortSecureMode(anchorPath, 0o600)
  }
  // Connection configuration, project bindings, and their integrity records
  // contain security metadata. Keep them private on POSIX filesystems where
  // possible.
  await bestEffortSecureMode(storagePath, 0o700)
  await bestEffortSecureMode(protectedFilePath, 0o600)
  await bestEffortSecureMode(localPath, 0o600)
}

/** Persist a config and its integrity records after a trusted CLI write. */
export async function writeConfigIntegrity(
  storagePath: string,
  configContent: string
): Promise<void> {
  await writeConfigWithIntegrity(storagePath, configContent)
}

interface FileSnapshot {
  path: string
  content: string | null
}

async function snapshot(path: string): Promise<FileSnapshot> {
  const file = Bun.file(path)
  return { path, content: (await file.exists()) ? await file.text() : null }
}

async function restore(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.content === null) {
    await unlink(snapshot.path).catch(() => undefined)
    return
  }
  const temporary = `${snapshot.path}.rollback-${process.pid}-${randomUUID()}`
  await Bun.write(temporary, snapshot.content)
  await rename(temporary, snapshot.path)
}

/**
 * Publish config.json and its integrity records as one recoverable unit. All
 * replacements are prepared before publication. If a later replacement fails,
 * already-published files are restored to their prior versions.
 */
export async function writeConfigWithIntegrity(
  storagePath: string,
  configContent: string
): Promise<void> {
  await writeProtectedFileWithIntegrity(storagePath, 'config.json', configContent, INTEGRITY_FILE)
}

/** Persist a project binding and its integrity records after a trusted CLI write. */
export async function writeBindingWithIntegrity(
  projectPath: string,
  bindingContent: string
): Promise<void> {
  await writeProtectedFileWithIntegrity(
    projectPath,
    'config.json',
    bindingContent,
    '.binding-integrity.json'
  )
}

/** Backwards-compatible name for the binding writer. */
export async function writeBindingIntegrity(
  projectPath: string,
  bindingContent: string
): Promise<void> {
  await writeBindingWithIntegrity(projectPath, bindingContent)
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

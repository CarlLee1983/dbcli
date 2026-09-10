/**
 * SQLite init command implementation.
 *
 * Separate from `init.ts` for the same reason `init-mongodb.ts` is: the generic
 * flow asks for host, port, user, password and database, and a SQLite
 * connection has none of them. It has a file path, and that is the whole
 * interview.
 *
 * The path is validated before anything is written. dbcli connects to
 * databases; it does not bring them into existence from a path, so a target
 * that does not exist is a refusal rather than a `CREATE`.
 */

import { t, t_vars } from '@/i18n/message-loader'
import { configModule } from '@/core/config'
import { promptUser } from '@/utils/prompts'
import type { ConnectionConfig } from '@/types'
import { AdapterFactory, ConnectionError, type ConnectionOptions } from '@/adapters'
import { SQLITE_MEMORY_TARGET_MESSAGE } from '@/utils/validation'
import {
  getProjectStoragePath,
  isGlobalConfigPath,
  migrateLegacyProjectEnvLocal,
  writeProjectBinding,
} from '@/core/config-binding'
import { checkOverwrite, writeV2InitConfig } from './init-shared'
import { mkdir } from 'node:fs/promises'

const VALID_PERMISSIONS = ['query-only', 'read-write', 'data-admin', 'admin'] as const

/**
 * The in-memory forms, refused here as well as in the schema — ADR-0038.
 *
 * The schema is the boundary that matters; this is so the person typing at a
 * prompt is told immediately rather than after the write is attempted.
 */
function isMemoryTarget(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === ':memory:') return true
  if (!trimmed.startsWith('file:')) return false
  const withoutScheme = trimmed.slice('file:'.length)
  const [path = '', query = ''] = withoutScheme.split('?')
  if (path === ':memory:') return true
  return new URLSearchParams(query).get('mode') === 'memory'
}

export async function handleSQLiteInit(ctx: {
  options: Record<string, unknown>
  configPath: string
  connectionName: string
  isV2Init: boolean
  /** The existing v1 config blob; intentionally loose, as in the MongoDB flow. */

  existingConfig: any
  shouldPrompt: boolean
}): Promise<void> {
  const { options, configPath, connectionName, isV2Init, existingConfig } = ctx
  const isInteractive = options.interactive !== false && process.stdin.isTTY

  let file = (options.file as string | undefined)?.trim()

  while (!file && isInteractive) {
    const input = (await promptUser.text(t('init.prompt_sqlite_file'))).trim()
    if (!input) continue
    if (isMemoryTarget(input)) {
      console.error(SQLITE_MEMORY_TARGET_MESSAGE)
      continue
    }
    file = input
  }

  if (!file) {
    throw new Error(t('errors.sqlite_file_required'))
  }
  if (isMemoryTarget(file)) {
    throw new Error(SQLITE_MEMORY_TARGET_MESSAGE)
  }

  const sqliteConfig = { system: 'sqlite', file } as unknown as ConnectionConfig

  // Permission
  let permission = (options.permission as string) || 'query-only'
  if (isInteractive && !options.permission) {
    permission = await promptUser.select(t('init.prompt_permission'), [
      'query-only',
      'read-write',
      'data-admin',
      'admin',
    ])
  }
  if (!(VALID_PERMISSIONS as readonly string[]).includes(permission)) {
    throw new Error(t_vars('errors.invalid_permission', { permission }))
  }

  const canProceed = await checkOverwrite(configPath, isInteractive, !!options.force)
  if (!canProceed) return

  // The connection test is where "does this path exist, is it readable, is it a
  // SQLite database" is answered, because the adapter already answers all
  // three and answering them twice would let the two answers disagree.
  if (!options.skipTest) {
    console.log(t('init.connection_testing'))
    const adapter = AdapterFactory.createAdapterWithoutRules(
      sqliteConfig as unknown as ConnectionOptions
    )
    try {
      await adapter.connect()
      await adapter.testConnection()
      console.log(t('init.connection_success'))
    } catch (error) {
      if (error instanceof ConnectionError) {
        console.error(t_vars('errors.connection_failed', { message: error.message }))
        console.error(t('init.connection_hints'))
        error.hints.forEach((hint) => console.error(`  • ${hint}`))
        process.exit(1)
      }
      throw error
    } finally {
      await adapter.disconnect()
    }
  }

  if (isV2Init) {
    await writeV2InitConfig(
      configPath,
      connectionName,
      sqliteConfig,
      permission,
      options.envFile as string | undefined
    )
    return
  }

  const newConfig = configModule.merge(existingConfig, {
    connection: sqliteConfig as never,
    permission: permission as 'query-only' | 'read-write' | 'data-admin' | 'admin',
  })
  const globalConfig = isGlobalConfigPath(configPath)
  const storagePath = globalConfig ? configPath : getProjectStoragePath(configPath)
  await mkdir(storagePath, { recursive: true })
  await configModule.write(storagePath, newConfig)
  if (!globalConfig) {
    await migrateLegacyProjectEnvLocal(configPath, storagePath)
    await writeProjectBinding(configPath, storagePath)
  }
  console.log(t('init.config_saved'))
}

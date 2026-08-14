/**
 * 單一連線的密碼輪替：只動該連線的密碼，其餘設定原封不動。
 *
 * 密碼實際落在哪裡由 config 決定，不是靠命名規則猜的——
 * 連線若已用 `{ $env: NAME }`，就改寫 NAME 這個 key；若還是明文，
 * 先把 config 轉成 env 參照再寫檔，之後的輪替就不必再碰 config.json。
 */

import { join } from 'path'
import { resolveConfigStoragePath } from '@/core/config-binding'
import {
  readV2Config,
  writeV2Config,
  connectionNotFoundMessage,
  detectConfigVersion,
} from '@/core/config-v2'
import { writeConfigWithIntegrity } from '@/core/config-integrity'
import { assertConfigMutationApproved } from '@/core/config-mutation-guard'
import { envVarNameFor } from '@/core/config-v2-mutations'
import { ConfigError } from '@/utils/errors'
import { upsertEnvVar } from '@/core/env-file-writer'
import type { DbcliConfigV2 } from '@/utils/validation'

/** 連線沒指定 envFile 時的落點，與讀取端的 `.env.local` fallback 一致。 */
const DEFAULT_ENV_FILE = '.env.local'

/** v1 設定沒有連線名稱，密碼固定落在 `.env.local` 的這個 key（與讀取端一致）。 */
const V1_VAR_NAME = 'DBCLI_PASSWORD'
const V1_CONNECTION_NAME = 'default'

export interface PasswordTarget {
  /** 被更新的連線名稱 */
  connection: string
  /** 密碼寫入的 env 檔（相對於 config storage 目錄） */
  envFile: string
  /** 寫入的環境變數名稱 */
  varName: string
  /** 這次是否需要把 config 裡的明文密碼轉成 $env 參照 */
  convertedToEnvRef: boolean
}

async function readRawConfig(storagePath: string): Promise<Record<string, unknown>> {
  const configPath = join(storagePath, 'config.json')
  const file = Bun.file(configPath)
  if (!(await file.exists())) {
    throw new ConfigError(`找不到設定檔：${configPath}`)
  }
  return JSON.parse(await file.text()) as Record<string, unknown>
}

function envRefName(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null && '$env' in value) {
    return String((value as { $env: unknown }).$env)
  }
  return undefined
}

/**
 * 查出「這條連線的密碼該寫到哪個 env 檔的哪個 key」，不寫入任何檔案。
 *
 * 驗證新密碼時得先知道 key 名稱才能注入，所以查詢與寫入分開。
 */
export async function resolvePasswordTarget(
  projectPath: string,
  connectionName?: string
): Promise<PasswordTarget> {
  const storagePath = await resolveConfigStoragePath(projectPath)
  const raw = await readRawConfig(storagePath)

  if (detectConfigVersion(raw) !== 2) {
    if (connectionName && connectionName !== V1_CONNECTION_NAME) {
      throw new ConfigError(
        `這是 v1 設定，只有一條連線，無法指定連線名稱 '${connectionName}'。` +
          `需要多連線請先用 dbcli init --conn-name <name> 升級到 v2。`
      )
    }
    const connection = (raw.connection ?? {}) as Record<string, unknown>
    const customRef = envRefName(connection.password)
    if (customRef !== undefined && customRef !== V1_VAR_NAME) {
      // v1 讀取端只認 `.env.local` 的 DBCLI_PASSWORD,沒有 per-connection envFile
      // 機制,所以寫任何檔案都無法讓 `${customRef}` 有值——與其寫完回報成功,
      // 不如說清楚該去哪裡改。
      throw new ConfigError(
        `這個 v1 設定的密碼來自環境變數 '${customRef}'，dbcli 無法代為輪替。` +
          `請直接更新該環境變數，或用 dbcli init --conn-name <name> 升級到 v2 後再輪替。`
      )
    }
    return {
      connection: V1_CONNECTION_NAME,
      envFile: DEFAULT_ENV_FILE,
      varName: V1_VAR_NAME,
      convertedToEnvRef: false,
    }
  }

  const config = await readV2Config(projectPath)
  const targetName = connectionName ?? config.default
  const connection = config.connections[targetName] as
    | { password?: unknown; envFile?: string }
    | undefined
  if (!connection) {
    throw new ConfigError(connectionNotFoundMessage(targetName, Object.keys(config.connections)))
  }

  const referencedVar = envRefName(connection.password)
  return {
    connection: targetName,
    envFile: connection.envFile ?? DEFAULT_ENV_FILE,
    varName: referencedVar ?? envVarNameFor(targetName, 'password'),
    convertedToEnvRef: referencedVar === undefined,
  }
}

function assertSingleLine(value: string): void {
  if (value.includes('\n') || value.includes('\r')) {
    throw new ConfigError('密碼不可包含換行字元')
  }
}

/**
 * v1：密碼寫進 `.env.local`，config.json 若還留著明文就一併拿掉——
 * 否則讀取端會優先採用它，新密碼形同沒改。
 */
async function stripV1LiteralPassword(
  storagePath: string,
  raw: Record<string, unknown>
): Promise<void> {
  const connection = (raw.connection ?? {}) as Record<string, unknown>
  if (typeof connection.password !== 'string') return

  const stripped = { ...raw, connection: { ...connection } }
  delete (stripped.connection as { password?: unknown }).password
  await writeConfigWithIntegrity(storagePath, JSON.stringify(stripped, null, 2))
}

export async function setConnectionPassword(
  projectPath: string,
  connectionName: string | undefined,
  password: string
): Promise<PasswordTarget> {
  assertConfigMutationApproved()
  assertSingleLine(password)

  const target = await resolvePasswordTarget(projectPath, connectionName)
  const storagePath = await resolveConfigStoragePath(projectPath)
  const raw = await readRawConfig(storagePath)

  // 先寫 env 檔再改 config：反過來的話，config 改完但寫檔失敗就會指向一個
  // 不存在的變數，連線當場壞掉。這個順序下中斷只會停在「新值已就位、
  // config 還指著舊來源」，舊密碼照常可用。
  await upsertEnvVar(join(storagePath, target.envFile), target.varName, password)

  if (detectConfigVersion(raw) !== 2) {
    await stripV1LiteralPassword(storagePath, raw)
    return target
  }

  const config = await readV2Config(projectPath)
  const connection = config.connections[target.connection] as Record<string, unknown>
  // envFile 沒宣告時也要補寫進去:loadConnectionEnv 只載入連線自己宣告的檔案,
  // 而讀取端對 `.env.local` 的舊 fallback 只認 v1 的 DBCLI_PASSWORD 這一個 key。
  // 不補的話密碼寫得再對,讀取端也看不到。
  const needsEnvFile = connection.envFile === undefined
  if (target.convertedToEnvRef || needsEnvFile) {
    await writeV2Config(projectPath, {
      ...config,
      connections: {
        ...config.connections,
        [target.connection]: {
          ...connection,
          envFile: target.envFile,
          ...(target.convertedToEnvRef && { password: { $env: target.varName } }),
        },
      },
    } as DbcliConfigV2)
  }

  return target
}

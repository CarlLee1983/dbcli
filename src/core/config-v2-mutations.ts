import { join } from 'path'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { readV2Config } from '@/core/config-v2'
import type { DbcliConfigV2 } from '@/utils/validation'

export type SqlSystem = 'postgresql' | 'mysql' | 'mariadb'

/**
 * `$env` 變數名。per-connection 命名空間化:常駐 sidecar 共用 process.env,
 * 且 loadEnvFile 不覆寫既有 key——若兩連線都用 DB_PASSWORD 會撞名取到對方的值。
 */
export function envVarNameFor(connName: string, field: 'password'): string {
  const slug = connName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `DBCLI_${slug}_${field.toUpperCase()}`
}

/** 把 secret 寫進該連線的 envFile(KEY=VALUE);既有同名 key 就地覆寫,否則追加。 */
export async function writeConnectionSecret(
  projectPath: string,
  connName: string,
  field: 'password',
  value: string,
): Promise<void> {
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error('secret value 不可包含換行字元')
  }

  const config = await readV2Config(projectPath)
  const conn = config.connections[connName]
  if (!conn) throw new Error(`連線 '${connName}' 不存在`)

  const storagePath = await resolveConfigStoragePath(projectPath)
  const envFile = conn.envFile ?? `.env.${connName}`
  const envPath = join(storagePath, envFile)
  const varName = envVarNameFor(connName, field)

  let content = ''
  const file = Bun.file(envPath)
  if (await file.exists()) content = await file.text()

  const line = `${varName}=${value}`
  const re = new RegExp(`^${varName}=.*$`, 'm')
  if (re.test(content)) {
    content = content.replace(re, line)
  } else {
    content = content.length && !content.endsWith('\n') ? `${content}\n${line}\n` : `${content}${line}\n`
  }
  await Bun.write(envPath, content)
}

export interface ConnectionInput {
  name: string
  system: SqlSystem
  host: string
  port: number
  user: string
  database: string
}

/** 刪除連線(immutable)。刪預設則改派為剩餘第一條;刪最後一條則擋下(v2 需至少一條)。 */
export function removeConnection(config: DbcliConfigV2, name: string): DbcliConfigV2 {
  if (!(name in config.connections)) throw new Error(`連線 '${name}' 不存在`)
  const rest = { ...config.connections }
  delete rest[name]
  const remaining = Object.keys(rest)
  if (remaining.length === 0) throw new Error('無法刪除最後一條連線')
  const nextDefault = config.default === name ? remaining[0] : config.default
  return { ...config, connections: rest, default: nextDefault } as DbcliConfigV2
}

/** 設定預設連線(immutable)。 */
export function setDefaultConnection(config: DbcliConfigV2, name: string): DbcliConfigV2 {
  if (!(name in config.connections)) throw new Error(`連線 '${name}' 不存在`)
  return { ...config, default: name } as DbcliConfigV2
}

/** 新增或就地覆寫同名連線(immutable)。非機密欄存字面值,password 存 {$env} 參照 +
 *  per-connection envFile。編輯時保留既有 permission;新建預設 'query-only'。 */
export function upsertConnection(config: DbcliConfigV2, input: ConnectionInput): DbcliConfigV2 {
  const existing = config.connections[input.name] as { permission?: string } | undefined
  const connection = {
    system: input.system,
    host: input.host,
    port: input.port,
    user: input.user,
    database: input.database,
    password: { $env: envVarNameFor(input.name, 'password') },
    permission: existing?.permission ?? 'query-only',
    envFile: `.env.${input.name}`,
  }
  return {
    ...config,
    connections: { ...config.connections, [input.name]: connection },
  } as DbcliConfigV2
}

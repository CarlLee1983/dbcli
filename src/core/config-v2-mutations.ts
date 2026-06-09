import { join } from 'path'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { readV2Config } from '@/core/config-v2'

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

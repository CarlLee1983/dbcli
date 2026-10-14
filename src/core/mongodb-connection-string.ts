/**
 * 把 MongoDB 連線字串拆解成欄位設定（ADR-0043）。
 *
 * 欄位設定表達不了的字串（多組 host、帶機密的 option）不拆，回傳退回 `uri` 的原因，
 * 由呼叫端決定如何警告。其餘字串拆成欄位設定，日後可單獨修改任一欄位。
 */

import { t, t_vars } from '@/i18n/message-loader'
import { RESERVED_MONGODB_OPTION_KEYS } from '@/utils/validation'

// 套件的 ESM wrapper 在 Bun 下取不到具名匯出（ConnectionString 為 undefined），
// 改走 CJS 入口，與 mongodb driver 自己載入它的方式相同。
const { ConnectionString } =
  require('mongodb-connection-string-url') as typeof import('mongodb-connection-string-url')

/** 這些 option 帶機密；拆進 `options` 會明文落盤卻看不出來，所以整條退回 `uri`。 */
const SECRET_OPTION_KEYS = [
  'authmechanismproperties',
  'tlscertificatekeyfilepassword',
  'proxypassword',
] as const

export interface MongoFieldConfig {
  system: 'mongodb'
  host: string
  port?: number
  user: string
  password: string
  database: string
  authSource?: string
  replicaSet?: string
  tls?: boolean
  srv?: true
  options?: Record<string, string>
}

/** 欄位設定能用 SCRAM 表達；其他機制（X509、GSSAPI、PLAIN、AWS）不帶密碼，也不能補預設 authSource。 */
const SCRAM_MECHANISMS = ['scram-sha-1', 'scram-sha-256'] as const

export type FallbackReason =
  | { type: 'multi-host' }
  | { type: 'unix-socket' }
  | { type: 'secret-option'; keys: string[] }
  | { type: 'duplicate-key'; keys: string[] }
  | { type: 'non-scram-mechanism'; mechanism: string }

export type DecomposeResult =
  | { kind: 'fields'; config: MongoFieldConfig }
  | { kind: 'uri'; database: string; reasons: FallbackReason[] }

const DEFAULT_PORT = 27017

/** 解析器遇到不合法的帳密字元時塞進去的佔位字串，出現在任何欄位都代表字串有問題。 */
const PARSER_PLACEHOLDER = '__this_is_a_placeholder__'

/** `host`、`host:port`、`[::1]:port` 切成主機與埠號；格式或埠號範圍不對就拋錯。 */
function splitHostPort(authority: string): { host: string; port: number | undefined } {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(authority)
  const port = match?.[2] ? parseInt(match[2], 10) : undefined
  if (!match || (port !== undefined && (port < 1 || port > 65535))) {
    throw new Error(t('init.mongo_string_bad_host'))
  }
  return { host: match[1]!, port }
}

function parseTlsValue(key: string, value: string): boolean {
  const lowered = value.toLowerCase()
  if (lowered === 'true') return true
  if (lowered === 'false') return false
  throw new Error(t_vars('init.mongo_string_bad_tls', { key }))
}

/**
 * @throws 字串不是合法的 MongoDB 連線字串，或 tls 與 ssl 同時出現且值不同
 */
export function decomposeConnectionString(uri: string): DecomposeResult {
  let parsed: InstanceType<typeof ConnectionString>
  try {
    parsed = new ConnectionString(uri)
  } catch (cause) {
    // 套件的錯誤訊息會原樣帶上整條字串（含密碼），所以不轉述，只用 cause 保留原錯誤
    throw new Error(t('init.mongo_string_invalid'), { cause })
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const queryKeys = [...parsed.searchParams.keys()]
  const secretKeys = queryKeys.filter((key) =>
    (SECRET_OPTION_KEYS as readonly string[]).includes(key.toLowerCase())
  )
  const reasons: FallbackReason[] = []
  // Match the driver's HostAddress socket discriminator before TCP decomposition.
  // Keeping the raw URI also preserves encoded paths and their case.
  if (!parsed.isSRV && parsed.hosts.some((host) => host.endsWith('.sock'))) {
    reasons.push({ type: 'unix-socket' })
  }
  if (parsed.hosts.length > 1) reasons.push({ type: 'multi-host' })
  if (secretKeys.length > 0) reasons.push({ type: 'secret-option', keys: secretKeys })

  // 不分大小寫的同名鍵：欄位或 options 都只能存一個值，拆解會悄悄丟掉其他的
  const seen = new Set<string>()
  const duplicateKeys = new Set<string>()
  for (const key of queryKeys) {
    const lowered = key.toLowerCase()
    if (seen.has(lowered)) duplicateKeys.add(key)
    seen.add(lowered)
  }
  if (duplicateKeys.size > 0) reasons.push({ type: 'duplicate-key', keys: [...duplicateKeys] })

  const mechanism = [...parsed.searchParams.entries()].find(
    ([key]) => key.toLowerCase() === 'authmechanism'
  )?.[1]
  if (
    mechanism !== undefined &&
    !(SCRAM_MECHANISMS as readonly string[]).includes(mechanism.toLowerCase())
  ) {
    reasons.push({ type: 'non-scram-mechanism', mechanism })
  }
  if (reasons.length > 0) return { kind: 'uri', database, reasons }

  const carriesPlaceholder = [
    parsed.username,
    parsed.password,
    parsed.pathname,
    ...parsed.hosts,
    ...parsed.searchParams.values(),
  ].some((part) => part.includes(PARSER_PLACEHOLDER))
  if (carriesPlaceholder) throw new Error(t('init.mongo_string_bad_credentials'))

  const dedicated: Record<string, string> = {}
  const tlsValues: boolean[] = []
  const options: Record<string, string> = {}
  for (const [key, value] of parsed.searchParams.entries()) {
    const field = RESERVED_MONGODB_OPTION_KEYS[key.toLowerCase()]
    // 保留鍵給了空值不當成沒寫：使用者顯然想設定卻漏了值
    if (field && value === '') throw new Error(t_vars('init.mongo_string_empty_option', { key }))
    if (field === 'tls') tlsValues.push(parseTlsValue(key, value))
    else if (field) dedicated[field] = value
    else options[key] = value
  }
  if (new Set(tlsValues).size > 1) {
    throw new Error(t('init.mongo_string_tls_conflict'))
  }

  const user = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  const { host, port } = splitHostPort(parsed.hosts[0]!)

  // driver 對非 SRV、有帳號、路徑帶資料庫的字串以路徑資料庫認證；欄位設定沒寫
  // authSource 時 adapter 會補 admin，所以要明確寫出，兩種形式才連到同一個庫。
  const authSource =
    dedicated.authSource ?? (!parsed.isSRV && user && database ? database : undefined)

  const config: MongoFieldConfig = {
    system: 'mongodb',
    host,
    ...(parsed.isSRV ? {} : { port: port ?? DEFAULT_PORT }),
    user,
    password,
    database,
    ...(authSource !== undefined ? { authSource } : {}),
    ...(dedicated.replicaSet !== undefined ? { replicaSet: dedicated.replicaSet } : {}),
    ...(tlsValues.length > 0 ? { tls: tlsValues[0] } : {}),
    ...(parsed.isSRV ? { srv: true as const } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  }
  return { kind: 'fields', config }
}

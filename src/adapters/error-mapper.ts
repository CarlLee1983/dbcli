/**
 * Error mapper for database connection errors
 * Categorizes driver errors into user-friendly messages with actionable hints
 *
 * 分類順序是刻意的：driver 給的 error code / SQLSTATE 是資料庫自己的判斷，
 * 訊息字串只是它的說法。先前的實作反過來，於是任何訊息裡出現 "user" 的錯誤
 * ——例如 `unique constraint "users_email_key"`——都被回報成「認證失敗，請
 * 檢查帳號密碼」，把除錯方向整個帶偏。字串比對只在完全沒有 code 時才動用，
 * 而且比對的是完整詞組而非子字串。
 */

import { ConnectionError, type ConnectionOptions } from './types'

type DbSystem = 'postgresql' | 'mysql' | 'mariadb' | 'redis'

/** 由 driver code / SQLSTATE / errno 判定的類別；null 表示這個 code 不認得 */
type CodedCategory =
  | 'ECONNREFUSED'
  | 'ETIMEDOUT'
  | 'ENOTFOUND'
  | 'AUTH_FAILED'
  | 'TABLE_NOT_FOUND'
  | 'COLUMN_NOT_FOUND'
  | 'SQL_SYNTAX_ERROR'
  | 'STATEMENT_TIMEOUT'
  | 'EHOSTUNREACH'
  | 'CONNECTION_LOST'
  | 'TOO_MANY_CONNECTIONS'
  | 'TLS_ERROR'

/** OS / driver 層級的連線錯誤代碼 */
const TRANSPORT_CODES: Record<string, CodedCategory> = {
  ECONNREFUSED: 'ECONNREFUSED',
  ETIMEDOUT: 'ETIMEDOUT',
  ESOCKETTIMEDOUT: 'ETIMEDOUT',
  ENOTFOUND: 'ENOTFOUND',
  EAI_AGAIN: 'ENOTFOUND',
  PROTOCOL_CONNECTION_LOST: 'CONNECTION_LOST',
  PROTOCOL_SEQUENCE_TIMEOUT: 'ETIMEDOUT',
  // 連線建立過但中途斷掉：伺服器重啟、idle timeout、網路中斷都會走到這裡。
  // 這些先前落在「有 code 但不認得」的分支，訊息變成 Database error (ECONNRESET)。
  ECONNRESET: 'CONNECTION_LOST',
  EPIPE: 'CONNECTION_LOST',
  ECONNABORTED: 'CONNECTION_LOST',
  // 路由層不通，與 DNS 查不到（ENOTFOUND）是兩回事
  EHOSTUNREACH: 'EHOSTUNREACH',
  ENETUNREACH: 'EHOSTUNREACH',
  ENETDOWN: 'EHOSTUNREACH',
  // TLS 憑證。node 的 TLS 錯誤把原因放在 code 上，訊息本身常常只有一句英文縮寫
  CERT_HAS_EXPIRED: 'TLS_ERROR',
  CERT_NOT_YET_VALID: 'TLS_ERROR',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS_ERROR',
  SELF_SIGNED_CERT_IN_CHAIN: 'TLS_ERROR',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS_ERROR',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'TLS_ERROR',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS_ERROR',
}

/** MySQL / MariaDB 的具名錯誤碼 */
const MYSQL_CODES: Record<string, CodedCategory> = {
  ER_NO_SUCH_TABLE: 'TABLE_NOT_FOUND',
  ER_BAD_FIELD_ERROR: 'COLUMN_NOT_FOUND',
  ER_PARSE_ERROR: 'SQL_SYNTAX_ERROR',
  ER_ACCESS_DENIED_ERROR: 'AUTH_FAILED',
  ER_DBACCESS_DENIED_ERROR: 'AUTH_FAILED',
  ER_NOT_SUPPORTED_AUTH_MODE: 'AUTH_FAILED',
  ER_MUST_CHANGE_PASSWORD_LOGIN: 'AUTH_FAILED',
  // MySQL 3024 / MariaDB 1969：兩者都只由各自的語句上限觸發，與 KILL QUERY 的
  // 1317 (ER_QUERY_INTERRUPTED) 不同——後者刻意不列，那是人為中斷不是逾時。
  ER_QUERY_TIMEOUT: 'STATEMENT_TIMEOUT', // MySQL max_execution_time
  ER_STATEMENT_TIMEOUT: 'STATEMENT_TIMEOUT', // MariaDB max_statement_time
  ER_CON_COUNT_ERROR: 'TOO_MANY_CONNECTIONS', // 1040：max_connections 用盡
  ER_SERVER_SHUTDOWN: 'CONNECTION_LOST', // 1053
}

/** MySQL / MariaDB 的數字 errno（部分 driver 只給數字） */
const MYSQL_ERRNOS: Record<number, CodedCategory> = {
  1045: 'AUTH_FAILED',
  1044: 'AUTH_FAILED',
  1054: 'COLUMN_NOT_FOUND',
  1064: 'SQL_SYNTAX_ERROR',
  1146: 'TABLE_NOT_FOUND',
  1251: 'AUTH_FAILED',
  1698: 'AUTH_FAILED',
  1040: 'TOO_MANY_CONNECTIONS', // ER_CON_COUNT_ERROR
  1053: 'CONNECTION_LOST', // ER_SERVER_SHUTDOWN
  2006: 'CONNECTION_LOST', // CR_SERVER_GONE_ERROR
  2013: 'CONNECTION_LOST', // CR_SERVER_LOST
  1969: 'STATEMENT_TIMEOUT', // MariaDB ER_STATEMENT_TIMEOUT
  3024: 'STATEMENT_TIMEOUT', // MySQL ER_QUERY_TIMEOUT
}

/** PostgreSQL SQLSTATE */
const SQLSTATES: Record<string, CodedCategory> = {
  '28000': 'AUTH_FAILED', // invalid_authorization_specification
  '28P01': 'AUTH_FAILED', // invalid_password
  '42601': 'SQL_SYNTAX_ERROR', // syntax_error
  '42P01': 'TABLE_NOT_FOUND', // undefined_table
  '42703': 'COLUMN_NOT_FOUND', // undefined_column
  '57014': 'STATEMENT_TIMEOUT', // query_canceled — statement_timeout 或人為取消
  // class 08：連線相關。這些有 code，所以不會經過無 code 才跑的字串後備比對
  '08000': 'CONNECTION_LOST', // connection_exception
  '08003': 'CONNECTION_LOST', // connection_does_not_exist
  '08006': 'CONNECTION_LOST', // connection_failure
  '08001': 'ECONNREFUSED', // sqlclient_unable_to_establish_sqlconnection
  '08004': 'ECONNREFUSED', // sqlserver_rejected_establishment_of_sqlconnection
  '53300': 'TOO_MANY_CONNECTIONS', // too_many_connections
  // class 57：伺服器主動結束連線。實測 `docker restart` 途中的查詢回的就是 57P01，
  // 先前它落到「有 code 但不認得」，提示叫人去確認語句引用的物件。
  '57P01': 'CONNECTION_LOST', // admin_shutdown
  '57P02': 'CONNECTION_LOST', // crash_shutdown
  '57P03': 'CONNECTION_LOST', // cannot_connect_now — 伺服器啟動中，重試即可
}

/** Redis 的錯誤前綴（redis 的錯誤沒有 code 欄位，第一個 token 就是類別） */
const REDIS_PREFIXES: Record<string, CodedCategory> = {
  NOAUTH: 'AUTH_FAILED',
  WRONGPASS: 'AUTH_FAILED',
}

/**
 * 無 code 時的後備字串比對。每一項都是完整詞組——單字比對（'user'、'auth'）
 * 正是本檔案要修掉的誤判來源。
 */
const FALLBACK_PATTERNS: [RegExp, CodedCategory][] = [
  [/connection refused/i, 'ECONNREFUSED'],
  [/\bECONNREFUSED\b/, 'ECONNREFUSED'],
  [/connect(?:ion)? time(?:d )?out/i, 'ETIMEDOUT'],
  // pg 的連線池逾時：`timeout exceeded when trying to connect`，沒有 code
  [/timeout exceeded/i, 'ETIMEDOUT'],
  [/timed out/i, 'ETIMEDOUT'],
  // 斷線在 driver 那端常常沒有 code：pg 的 pool 直接丟 `Connection terminated
  // unexpectedly`，libpq 與 mysql2 各有自己的說法。實測 `docker kill` 途中的查詢
  // 走的就是第一條。
  [/connection terminated/i, 'CONNECTION_LOST'],
  [/server closed the connection/i, 'CONNECTION_LOST'],
  [/server has gone away/i, 'CONNECTION_LOST'],
  [/lost connection to .* server/i, 'CONNECTION_LOST'],
  [/getaddrinfo/i, 'ENOTFOUND'],
  [/authentication failed/i, 'AUTH_FAILED'],
  [/access denied for user/i, 'AUTH_FAILED'],
  [/no pg_hba\.conf entry/i, 'AUTH_FAILED'],
  [/role\s+".*?"\s+does not exist/i, 'AUTH_FAILED'],
  [/password supplied/i, 'AUTH_FAILED'],
]

/**
 * PostgreSQL `57014` is query_canceled, and statement_timeout is only one of its
 * sources — `pg_cancel_backend()`, a client-side cancel, and a standby recovery
 * conflict all raise the same SQLSTATE. Postgres separates them in the message,
 * and the distinction matters: the timeout branch states a ceiling in ms, which
 * would be a fabricated number for a cancel nobody configured a limit for.
 */
const PG_CANCEL_BY_TIMEOUT = /statement timeout/i

function categorize(errCode: string, errno: unknown, errMsg: string): CodedCategory | null {
  if (errCode) {
    const known =
      TRANSPORT_CODES[errCode] ??
      MYSQL_CODES[errCode] ??
      SQLSTATES[errCode] ??
      REDIS_PREFIXES[errCode]
    if (
      known === 'STATEMENT_TIMEOUT' &&
      errCode === '57014' &&
      !PG_CANCEL_BY_TIMEOUT.test(errMsg)
    ) {
      // 取消但不是逾時：伺服器已經說清楚原因，原樣轉述比套一個類別誠實
      return null
    }
    if (known) return known
  }
  if (typeof errno === 'number' && MYSQL_ERRNOS[errno]) return MYSQL_ERRNOS[errno]
  // Redis 的錯誤只有訊息，類別在第一個 token
  const redisPrefix = errMsg.match(/^([A-Z]+)\s/)?.[1]
  if (redisPrefix && REDIS_PREFIXES[redisPrefix]) return REDIS_PREFIXES[redisPrefix]

  // 有 code 卻不在表上：這是資料庫回報的具體錯誤，不該再用字串去猜
  if (errCode || typeof errno === 'number') return null

  for (const [pattern, category] of FALLBACK_PATTERNS) {
    if (pattern.test(errMsg)) return category
  }
  return null
}

/**
 * 每個引擎在提示裡要填的東西。先前這些散成五組 `system === 'postgresql' ? …`
 * 的三元階梯，加一個引擎就要記得改五個地方——而漏掉的那個會安靜地給出
 * 另一個引擎的指令。
 */
const SYSTEM_FACTS: Record<
  DbSystem,
  {
    serviceCheck: string
    defaultPort: string
    firewallRule: string
    client: string
    logFile: string
  }
> = {
  postgresql: {
    serviceCheck: 'systemctl status postgresql',
    defaultPort: 'default 5432',
    firewallRule: 'allow TCP 5432',
    client: 'psql',
    logFile: 'postgresql.log',
  },
  mysql: {
    serviceCheck: 'systemctl status mysql',
    defaultPort: 'default 3306',
    firewallRule: 'allow TCP 3306',
    client: 'mysql',
    logFile: 'mysql.log',
  },
  mariadb: {
    serviceCheck: 'systemctl status mariadb',
    defaultPort: 'default 3306',
    firewallRule: 'allow TCP 3306',
    client: 'mariadb',
    logFile: 'mariadb.log',
  },
  redis: {
    serviceCheck: 'redis-cli ping',
    defaultPort: 'default 6379',
    firewallRule: 'allow TCP 6379',
    client: 'redis-cli',
    logFile: 'redis.log',
  },
}

function serviceHints(system: DbSystem, options: ConnectionOptions): string[] {
  const facts = SYSTEM_FACTS[system]
  return [
    `Check that the ${system} service is running: ${facts.serviceCheck}`,
    `Verify the port is correct: ${facts.defaultPort}`,
    `Check that ${options.host} is reachable: ping ${options.host} or telnet ${options.host} ${options.port}`,
  ]
}

/**
 * Map database and OS errors to user-friendly ConnectionError with categorized hints
 *
 * @param error The original error from driver or OS
 * @param system Database system type for system-specific hints
 * @param options Connection options for context in error messages
 * @returns ConnectionError with categorized code, message, and troubleshooting hints
 */
export function mapError(
  error: unknown,
  system: DbSystem,
  options: ConnectionOptions
): ConnectionError {
  if (error instanceof ConnectionError) return error

  const err = error as Record<string, unknown>
  const errMsg = String(err?.message || String(error))
  const errCode = String(err?.code || '')
  const errno = err?.errno

  switch (categorize(errCode, errno, errMsg)) {
    case 'ECONNREFUSED':
      return new ConnectionError(
        'ECONNREFUSED',
        `Cannot connect to ${options.host}:${options.port} — server is not running or not listening on this port`,
        serviceHints(system, options)
      )

    case 'ETIMEDOUT':
      return new ConnectionError(
        'ETIMEDOUT',
        `Connection timed out (${options.timeout || 5000}ms) — may be blocked by a firewall or slow network`,
        [
          `Check firewall rules: ${SYSTEM_FACTS[system].firewallRule}`,
          `Increase timeout: edit .dbcli and add "timeout": 15000`,
          `Verify network connectivity: ping ${options.host} -c 3`,
        ]
      )

    case 'CONNECTION_LOST':
      return new ConnectionError(
        'CONNECTION_LOST',
        `Connection to ${options.host}:${options.port} was lost mid-session — the server closed it or the network dropped`,
        [
          'Re-run the command: a dropped connection is often transient',
          `Check whether the server restarted or is cycling: ${SYSTEM_FACTS[system].logFile}`,
          'If it happens on long-running work, look at the server idle/wait timeout',
        ]
      )

    case 'TOO_MANY_CONNECTIONS':
      return new ConnectionError(
        'TOO_MANY_CONNECTIONS',
        `${options.host}:${options.port} refused the connection — the server has no connection slots left`,
        [
          'Wait and retry: the limit is on concurrent connections, not on you',
          system === 'postgresql'
            ? 'Inspect usage: SELECT count(*) FROM pg_stat_activity — compare against max_connections'
            : 'Inspect usage: SHOW STATUS LIKE "Threads_connected" — compare against max_connections',
          'Close idle sessions, or raise max_connections if the load is legitimate',
        ]
      )

    case 'EHOSTUNREACH':
      return new ConnectionError(
        'EHOSTUNREACH',
        `No route to ${options.host} — the name resolved, but the host or network is unreachable`,
        [
          'Check that you are on the right network or VPN',
          `Check routing and firewall between here and ${options.host}`,
          `Confirm the address is the one you meant: ${options.host}:${options.port}`,
        ]
      )

    case 'TLS_ERROR':
      return new ConnectionError('TLS_ERROR', `TLS handshake failed: ${errMsg}`, [
        'Point the connection at the right CA bundle: set "caPath" in .dbcli',
        'For a self-signed certificate in a trusted network, set "rejectUnauthorized": false',
        `Confirm the certificate covers the host you connected to: ${options.host}`,
      ])

    case 'ENOTFOUND':
      return new ConnectionError('ENOTFOUND', `Host not found: ${options.host}`, [
        `Check the hostname spelling: ${options.host}`,
        `Verify DNS resolution: nslookup ${options.host}`,
        `If using localhost, try 127.0.0.1 (IPv4 vs IPv6 issue)`,
      ])

    case 'AUTH_FAILED':
      return new ConnectionError(
        'AUTH_FAILED',
        `Authentication failed — check your username or password`,
        [
          `Verify credentials: ${SYSTEM_FACTS[system].client} ${
            system === 'postgresql' ? '-U' : '-u'
          } ${options.user} -h ${options.host}`,
          `Check pg_hba.conf (PostgreSQL) or user privileges (MySQL)`,
          `Re-run dbcli init to update credentials`,
        ]
      )

    case 'TABLE_NOT_FOUND': {
      // Extract table name from message:
      //  - MySQL: Table 'db.tablename' doesn't exist
      //  - PG:    relation "tablename" does not exist
      const mysqlMatch = errMsg.match(/Table\s+'(?:[^.']+\.)?([^']+)'/i)
      const pgMatch = errMsg.match(/relation\s+"([^"]+)"/i)
      const tableName = mysqlMatch?.[1] || pgMatch?.[1] || 'unknown'
      return new ConnectionError(
        'TABLE_NOT_FOUND',
        `Table '${tableName}' not found in database '${options.database || 'unknown'}'`,
        [
          'Run `dbcli list` to see available tables',
          'Run `dbcli schema <table>` to confirm the exact name (ORM export names may differ from DB table names)',
        ]
      )
    }

    case 'COLUMN_NOT_FOUND': {
      const mysqlMatch = errMsg.match(/Unknown column\s+'([^']+)'/i)
      const pgMatch = errMsg.match(/column\s+"([^"]+)"\s+does not exist/i)
      const columnName = mysqlMatch?.[1] || pgMatch?.[1] || 'unknown'
      return new ConnectionError('COLUMN_NOT_FOUND', `Column '${columnName}' not found`, [
        'Run `dbcli schema <table>` to see the actual column names',
        'Column names are case-sensitive on some databases (PostgreSQL with quoted identifiers)',
      ])
    }

    case 'STATEMENT_TIMEOUT': {
      // 連線是通的，被砍掉的是這道語句——連線疑難排解在這裡是雜訊。
      const limitMs = options.statementTimeout ?? options.timeout
      return new ConnectionError(
        'STATEMENT_TIMEOUT',
        `Statement timed out${limitMs ? ` (${limitMs}ms)` : ''} — the server canceled this query before it finished`,
        [
          'Inspect the query plan: dbcli explain "<sql>"',
          'Raise the ceiling for this run: dbcli --statement-timeout <ms> … (0 removes it)',
          'Narrow the query: add WHERE filters, reduce the LIMIT, or index the scanned columns',
        ],
        limitMs
      )
    }

    case 'SQL_SYNTAX_ERROR':
      return new ConnectionError('SQL_SYNTAX_ERROR', `SQL syntax error: ${errMsg}`, [
        'Check your SQL syntax near the position reported above',
        'In query-only mode, dbcli auto-appends LIMIT 1000; use --no-limit to disable',
        'For SHOW/DESCRIBE/EXPLAIN statements, LIMIT is not allowed — these are not auto-limited',
      ])
  }

  // 認不得的 code：伺服器已經明確回報了什麼壞掉，原樣轉述比猜一個類別誠實。
  // 連線疑難排解提示在這裡是雜訊——連線是通的，錯的是這道語句。
  const reportedCode = errCode || (typeof errno === 'number' ? String(errno) : '')
  if (reportedCode) {
    return new ConnectionError('UNKNOWN', `Database error (${reportedCode}): ${errMsg}`, [
      'Run `dbcli schema <table>` to confirm the objects referenced by this statement',
      `Look up ${reportedCode} in the ${system} error reference for the exact cause`,
    ])
  }

  // 連 code 都沒有：只剩下連線層面的通用建議
  return new ConnectionError('UNKNOWN', `Connection failed: ${errMsg}`, [
    `Check connection parameters: host=${options.host}, port=${options.port}, user=${options.user}`,
    `View server logs: ${SYSTEM_FACTS[system].logFile}`,
    `Try connecting directly with the ${SYSTEM_FACTS[system].client} command-line tool`,
  ])
}

// Re-export ConnectionError for convenience
export { ConnectionError }

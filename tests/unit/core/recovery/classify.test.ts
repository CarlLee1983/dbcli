import { describe, test, expect } from 'bun:test'
import { classifyError } from '@/core/recovery/classify'
import { ConnectionError, type ConnectionErrorCode } from '@/adapters/types'
import { PermissionError, type StatementClassification } from '@/core/permission-guard'
import { BlacklistError } from '@/types/blacklist'
import { SavedQueryError } from '@/core/saved-queries/types'
import { RECOVERY_CODE_METADATA, SchemaCacheMissingError } from '@/core/recovery/types'

const stmt: StatementClassification = {
  type: 'INSERT',
  isDangerous: false,
  keywords: ['INSERT'],
  isComposite: false,
  confidence: 'HIGH',
}

describe('classifyError', () => {
  test('ConnectionError ECONNREFUSED → CONN_REFUSED', () => {
    const err = new ConnectionError('ECONNREFUSED', 'Connection refused at localhost:5432', [])
    const env = classifyError(err, { operation: 'query', system: 'postgresql' })
    expect(env.error.code).toBe('CONN_REFUSED')
    expect(env.error.category).toBe('connection')
    expect(env.error.details?.connectionCode).toBe('ECONNREFUSED')
    expect(env.error.message).not.toContain('localhost')
    expect(env.error.message).not.toContain('5432')
    expect(env.recovery.length).toBeGreaterThan(0)
    expect(env.ok).toBe(false)
    expect(env.schemaVersion).toBe(1)
    expect(typeof env.generatedAt).toBe('string')
    expect(new Date(env.generatedAt).toString()).not.toBe('Invalid Date')
  })

  test('ConnectionError AUTH_FAILED → CONN_AUTH_FAILED', () => {
    const err = new ConnectionError('AUTH_FAILED', 'Authentication failed: role "x"', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_AUTH_FAILED')
    expect(env.error.message).not.toContain('role "x"')
  })

  test('ConnectionError ETIMEDOUT → CONN_TIMEOUT', () => {
    const err = new ConnectionError('ETIMEDOUT', 'Timed out after 5000ms', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_TIMEOUT')
  })

  test('ConnectionError ENOTFOUND → CONN_HOST_NOT_FOUND', () => {
    const err = new ConnectionError('ENOTFOUND', 'Host not found: db.invalid', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_HOST_NOT_FOUND')
    expect(env.error.message).not.toContain('db.invalid')
  })

  test('ConnectionError UNKNOWN → CONN_UNKNOWN', () => {
    const err = new ConnectionError('UNKNOWN', 'Mystery failure', [])
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONN_UNKNOWN')
  })

  test('PermissionError → PERMISSION_DENIED preserves requiredPermission', () => {
    const err = new PermissionError('INSERT not allowed', stmt, 'read-write')
    const env = classifyError(err, { operation: 'insert' })
    expect(env.error.code).toBe('PERMISSION_DENIED')
    expect(env.error.details?.requiredPermission).toBe('read-write')
  })

  test('BlacklistError on read → BLACKLIST_TABLE preserves table', () => {
    const err = new BlacklistError("Table 'users' is blacklisted", 'users', 'SELECT')
    const env = classifyError(err, { operation: 'query', table: 'users' })
    expect(env.error.code).toBe('BLACKLIST_TABLE')
    expect(env.error.details?.table).toBe('users')
  })

  test('BlacklistError column-write phrasing → BLACKLIST_COLUMN_WRITE', () => {
    const err = new BlacklistError(
      "INSERT on table 'users' touches blacklisted columns: ssn",
      'users',
      'INSERT'
    )
    const env = classifyError(err, { operation: 'insert', table: 'users' })
    expect(env.error.code).toBe('BLACKLIST_COLUMN_WRITE')
    expect(env.error.details?.columns).toBe('ssn')
  })

  test('SavedQueryError NOT_FOUND → SNIPPET_NOT_FOUND', () => {
    const err = new SavedQueryError('Snippet not found: @diag/foo', 'NOT_FOUND')
    const env = classifyError(err, { operation: 'q', snippet: '@diag/foo' })
    expect(env.error.code).toBe('SNIPPET_NOT_FOUND')
    expect(env.error.details?.snippet).toBe('@diag/foo')
  })

  test('SavedQueryError AMBIGUOUS → SNIPPET_AMBIGUOUS', () => {
    const err = new SavedQueryError('Ambiguous match: @diag/foo', 'AMBIGUOUS')
    const env = classifyError(err, { operation: 'q', snippet: '@diag/foo' })
    expect(env.error.code).toBe('SNIPPET_AMBIGUOUS')
  })

  test('SavedQueryError PARAM_MISSING → SNIPPET_PARAM_MISSING captures paramName', () => {
    const err = new SavedQueryError('Missing required parameters: min_seconds', 'PARAM_MISSING')
    const env = classifyError(err, { operation: 'q', snippet: '@diag/long-running' })
    expect(env.error.code).toBe('SNIPPET_PARAM_MISSING')
    expect(env.error.details?.paramName).toBe('min_seconds')
  })

  test('SchemaCacheMissingError → SCHEMA_CACHE_MISSING', () => {
    const err = new SchemaCacheMissingError('No schema cache for users', 'users')
    const env = classifyError(err, { operation: 'query', table: 'users' })
    expect(env.error.code).toBe('SCHEMA_CACHE_MISSING')
    expect(env.error.details?.table).toBe('users')
  })

  test('Run dbcli init message → CONFIG_MISSING', () => {
    const err = new Error('Run "dbcli init" first')
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('CONFIG_MISSING')
  })

  test('unrecognized Error → UNKNOWN uses safe static description', () => {
    const err = new Error('connect ECONNREFUSED 10.0.0.5:5432 (password=secret)')
    const env = classifyError(err, { operation: 'query' })
    expect(env.error.code).toBe('UNKNOWN')
    expect(env.error.message).toBe(RECOVERY_CODE_METADATA.UNKNOWN.description)
    // Must not leak host, port, password, or other driver internals.
    expect(env.error.message).not.toContain('10.0.0.5')
    expect(env.error.message).not.toContain('5432')
    expect(env.error.message).not.toContain('password')
    expect(env.error.message).not.toContain('ECONNREFUSED')
  })

  test('non-Error thrown value → UNKNOWN uses safe static description', () => {
    const env = classifyError('plain string failure with secret=hunter2', { operation: 'query' })
    expect(env.error.code).toBe('UNKNOWN')
    expect(env.error.message).toBe(RECOVERY_CODE_METADATA.UNKNOWN.description)
    expect(env.error.message).not.toContain('hunter2')
    expect(env.error.message).not.toContain('plain string failure')
  })

  test('SavedQueryError unmapped code → UNKNOWN uses safe static description', () => {
    const err = new SavedQueryError(
      'Snippet engine mismatch on db=prod password=hunter2',
      'ENGINE_MISMATCH'
    )
    const env = classifyError(err, { operation: 'q', snippet: '@diag/foo' })
    expect(env.error.code).toBe('UNKNOWN')
    expect(env.error.message).toBe(RECOVERY_CODE_METADATA.UNKNOWN.description)
    expect(env.error.message).not.toContain('hunter2')
    expect(env.error.message).not.toContain('prod')
    expect(env.error.details?.snippet).toBe('@diag/foo')
  })
})

describe('classifyError populates envelope.verify', () => {
  test('CONN_REFUSED envelope carries doctor verify', () => {
    const env = classifyError(new ConnectionError('ECONNREFUSED', 'refused', []), {
      operation: 'query',
    })
    expect(env.error.code).toBe('CONN_REFUSED')
    expect(env.verify).toBeDefined()
    expect(env.verify!.risk).toBe('readonly')
    expect(env.verify!.command).toBe('dbcli doctor --format json')
  })

  test('BLACKLIST_TABLE envelope carries inspect --for-agent verify', () => {
    const env = classifyError(new BlacklistError('blocked', 'users', 'SELECT'), {
      operation: 'query',
      table: 'users',
    })
    expect(env.error.code).toBe('BLACKLIST_TABLE')
    expect(env.verify!.command).toBe('dbcli inspect --for-agent')
  })

  test('CONFIG_MISSING envelope carries inspect --no-connect verify', () => {
    const env = classifyError(new Error('Run "dbcli init" first'), { operation: 'query' })
    expect(env.error.code).toBe('CONFIG_MISSING')
    expect(env.verify!.command).toBe('dbcli inspect --no-connect --format json')
  })

  test('UNKNOWN fallback envelope still has a verify step', () => {
    const env = classifyError(new Error('boom'), { operation: 'query' })
    expect(env.error.code).toBe('UNKNOWN')
    expect(env.verify).toBeDefined()
  })
})

describe('classifyError — 語句逾時', () => {
  test('STATEMENT_TIMEOUT 走 CONN_TIMEOUT，但復原步驟針對查詢而非連線', () => {
    const err = new ConnectionError('STATEMENT_TIMEOUT', 'Statement timed out (800ms)', [])
    const env = classifyError(err, { operation: 'query', system: 'postgresql' })

    expect(env.schemaVersion).toBe(1)
    expect(env.error.code).toBe('CONN_TIMEOUT')
    expect(env.error.details?.connectionCode).toBe('STATEMENT_TIMEOUT')

    const commands = env.recovery.map((s) => s.command).join(' | ')
    expect(commands).toContain('dbcli explain')
    expect(commands).toContain('--statement-timeout')
    // 連線是通的，doctor / init 在這裡只會把 agent 帶錯方向
    expect(commands).not.toContain('dbcli doctor')
    expect(commands).not.toContain('dbcli init')
  })

  test('真正的連線逾時仍然拿到連線疑難排解步驟', () => {
    const err = new ConnectionError('ETIMEDOUT', 'Connection timed out', [])
    const env = classifyError(err, { operation: 'query', system: 'postgresql' })

    expect(env.error.code).toBe('CONN_TIMEOUT')
    expect(env.recovery.map((s) => s.command).join(' | ')).toContain('dbcli doctor')
  })
})

describe('classifyError — 語句逾時的 message', () => {
  test('不沿用 CONN_TIMEOUT 的「網路慢或被擋」描述', () => {
    const env = classifyError(new ConnectionError('STATEMENT_TIMEOUT', 'timed out (800ms)', []), {
      operation: 'query',
      system: 'postgresql',
    })

    expect(env.error.message).not.toBe(RECOVERY_CODE_METADATA.CONN_TIMEOUT.description)
    expect(env.error.message).toMatch(/statement/i)
    // 訊息仍不得帶出 host / port / SQL
    expect(env.error.message).not.toContain('pg_sleep')
    expect(env.error.message).not.toContain('localhost')
  })
})

describe('classifyError — 語句逾時的 envelope 整體不叫人跑 doctor', () => {
  test('recovery、verify、branches 都不含 doctor', () => {
    const env = classifyError(new ConnectionError('STATEMENT_TIMEOUT', 'timed out (800ms)', []), {
      operation: 'query',
      system: 'postgresql',
    })

    // 對整個 envelope 斷言：只看 recovery 會讓 verify 夾帶的 doctor 溜過去
    expect(JSON.stringify(env)).not.toContain('dbcli doctor')
  })
})

describe('classifyError — 語句逾時的上限值', () => {
  test('envelope 的 message 帶出當時生效的上限，agent 才知道 <ms> 要填多少', () => {
    const err = new ConnectionError('STATEMENT_TIMEOUT', 'Statement timed out (800ms)', [], 800)
    const env = classifyError(err, { operation: 'query', system: 'postgresql' })

    expect(env.error.message).toContain('800')
  })

  test('沒有上限值時不編一個出來', () => {
    const err = new ConnectionError('STATEMENT_TIMEOUT', 'Statement timed out', [])
    const env = classifyError(err, { operation: 'query', system: 'postgresql' })

    expect(env.error.message).toMatch(/statement/i)
    expect(env.error.message).not.toMatch(/\d+\s*ms/)
  })
})

describe('classifyError — #62 新增的傳輸層 code', () => {
  test('都落在 connection 類別，且不是 CONN_UNKNOWN 這個籠統值', () => {
    const expected: Record<string, string> = {
      CONNECTION_LOST: 'CONN_REFUSED',
      TOO_MANY_CONNECTIONS: 'CONN_REFUSED',
      EHOSTUNREACH: 'CONN_HOST_NOT_FOUND',
      // CONN_AUTH_FAILED 的計畫具體到「重跑 init 改帳密」，對憑證問題是錯的方向；
      // 步驟由 connectionCode 另外給，envelope code 維持籠統但不誤導的那個。
      TLS_ERROR: 'CONN_UNKNOWN',
    }

    for (const [connectionCode, recoveryCode] of Object.entries(expected)) {
      const env = classifyError(
        new ConnectionError(connectionCode as 'CONNECTION_LOST', 'boom', []),
        { operation: 'query', system: 'postgresql' }
      )
      expect(env.error.code).toBe(recoveryCode as typeof env.error.code)
      expect(env.error.category).toBe('connection')
      expect(env.error.details?.connectionCode).toBe(connectionCode as 'CONNECTION_LOST')
      // 連線類別仍該拿到 doctor 分支——連線確實是壞的
      expect(env.branches).toBeDefined()
    }
  })
})

describe('classifyError — #62 新 code 的 envelope 訊息', () => {
  test('不沿用會說反話的靜態描述', () => {
    const cases: [ConnectionErrorCode, RegExp][] = [
      // 「名稱解析成功但路由不通」對上 CONN_HOST_NOT_FOUND 的「主機名稱無法解析」
      ['EHOSTUNREACH', /unreachable|routing/i],
      ['TOO_MANY_CONNECTIONS', /slot|connection limit|concurrent/i],
      ['CONNECTION_LOST', /dropped|lost/i],
      ['TLS_ERROR', /tls|certificate/i],
    ]

    for (const [connectionCode, expected] of cases) {
      const env = classifyError(new ConnectionError(connectionCode, 'boom', []), {
        operation: 'query',
        system: 'postgresql',
      })

      expect(env.error.message).toMatch(expected)
      expect(env.error.message).not.toBe(RECOVERY_CODE_METADATA[env.error.code].description)
      // envelope 不得回吐 driver 原文
      expect(env.error.message).not.toContain('boom')
    }
  })

  test('TLS 問題不走「改帳密」那份計畫', () => {
    const env = classifyError(new ConnectionError('TLS_ERROR', 'bad cert', []), {
      operation: 'query',
      system: 'postgresql',
    })

    const commands = env.recovery.map((s) => s.command).join(' | ')
    // init --force 問的是帳密與 host，不會問 caPath / rejectUnauthorized
    expect(commands).not.toContain('dbcli init')
    expect(env.error.code).not.toBe('CONN_AUTH_FAILED')
  })

  test('連線數用盡的計畫不叫人改 host/port', () => {
    const env = classifyError(new ConnectionError('TOO_MANY_CONNECTIONS', 'full', []), {
      operation: 'query',
      system: 'postgresql',
    })

    const commands = env.recovery.map((s) => s.command).join(' | ')
    expect(commands).not.toContain('dbcli init')
  })
})

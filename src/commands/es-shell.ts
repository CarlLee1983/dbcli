import { createInterface } from 'node:readline'
import pc from 'picocolors'
import { configModule } from '../core/config'
import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import { createSubmitQueue } from './shell-submit-queue'
import { indexExpressionReaches, normalizeEsPath } from '@/utils/es-index-target'
import { escapeControlCharacters } from '@/utils/redaction'
import {
  classifyElasticsearchRequest,
  enforceElasticsearchPermission,
  routedPathname,
} from '@/core/permission/elasticsearch'
import type { Permission } from '@/types'
import { auditWriteFailed, writeAuditEntryResult } from '@/core/audit/integration-helper'
import { t } from '@/i18n/message-loader'
import {
  assertNoBlacklistedIndexNamed,
  assertNoProtectedFieldNamed,
  assertNoSmuggledBody,
  assertRequestTargetIsCanonical,
  blacklistIsConfigured,
  capSearchSize,
  collectProtectedFields,
  extractIndexFromPath,
  parseRequestTarget,
  redactFields,
  type EsRequest,
} from './es-shell-guards'

export { extractIndexFromPath } from './es-shell-guards'
export type { EsRequest } from './es-shell-guards'

/** Parse a Kibana Dev Tools block: first line "<METHOD> /<path>", remaining lines an optional JSON body. */
export function parseEsRequest(block: string): EsRequest {
  const lines = block.replace(/\r\n/g, '\n').split('\n')
  const firstIdx = lines.findIndex((l) => l.trim() !== '')
  if (firstIdx === -1) throw new Error(t('shell.es.parse_empty'))

  const header = lines[firstIdx]!.trim()
  const spaceIdx = header.indexOf(' ')
  if (spaceIdx === -1) {
    throw new Error(t('shell.es.parse_needs_method_path'))
  }
  const method = header.slice(0, spaceIdx).toUpperCase()
  const path = header.slice(spaceIdx + 1).trim()
  if (!path) throw new Error(t('shell.es.parse_needs_path'))

  const bodyText = lines
    .slice(firstIdx + 1)
    .join('\n')
    .trim()
  if (!bodyText) return { method, path }
  return { method, path, body: JSON.parse(bodyText) }
}

interface EsRequestCapable {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

/**
 * The tier an Elasticsearch shell session runs under.
 *
 * Absent configuration means the most restrictive tier, not the most
 * permissive: a connection that never said what it may do has not said it may
 * write. Named and exported so the default is pinned by a test rather than
 * living as an inline `??` nobody asserts.
 */
export function resolveEsShellPermission(config: { permission?: Permission }): Permission {
  return config.permission ?? 'query-only'
}

/**
 * What the shell tells its caller about a request it handled.
 *
 * Passed in rather than written here so the audit trail is exercised at the
 * same seam as everything else in this function, and so this module keeps no
 * opinion about where an entry goes.
 */
export interface EsShellAuditSink {
  (record: {
    /**
     * `attempt` is written before the request goes out, `outcome` after it
     * returns or throws. One row written only on the way back cannot describe a
     * request that never came back: a client-side timeout on
     * `_delete_by_query` aborts the socket while the cluster finishes the
     * delete, and a SIGTERM mid-request leaves nothing at all. The SQL path
     * records its gate decision before executing for the same reason — see
     * `recordGateDecision`.
     *
     * A request refused by the tier gate or the blacklist writes only
     * `outcome`: it was never attempted.
     */
    phase: 'attempt' | 'outcome'
    success: boolean
    error?: unknown
    target?: string
    /**
     * The operation, as `<METHOD> <routed path>`. Without it every shell entry
     * named its object and not its action, so `DELETE /orders`,
     * `POST /orders/_update_by_query`, `PUT /orders/_mapping` and
     * `POST /orders/_close` were one indistinguishable row. Built from the
     * routed path rather than the raw one, so the record says where the request
     * actually went.
     */
    statement: string
    /**
     * Set only when the request writes. The audit helper otherwise labels the
     * entry with the command's capability tier; this field overrides that for a
     * statement whose effect differs from its command's, which is why the same
     * destructive operation was once filed under three different tiers
     * depending on which command reached it.
     */
    tierOverride?: 'db-write'
  }): Promise<AuditSinkResult>
}

/**
 * sink 回報寫入結果，而不只是「有沒有丟例外」。
 *
 * `audit.strict` 要成立，呼叫端必須分得出「audit 關閉」與「audit 寫失敗」——
 * 前者是使用者的選擇，後者是控制失效，兩者的正確反應相反。
 *
 * `void | string | null` 留在型別裡是為了不強迫每個測試假造一個結果，代價是
 * 型別看起來允許把舊版 `writeAuditEntry`（失敗回 `null`）直接接上來。strict
 * 因此把這兩種形狀都當成失敗——便利的代價由 `auditSinkFailed` 承擔，不由
 * 安全性承擔。
 */
export type AuditSinkResult =
  | void
  | string
  | null
  | { skipped: 'disabled' }
  | { skipped: 'lock-budget-exhausted' }
  | { skipped: 'write-failed'; error: string }
  | { success: true; rotated: boolean; id: string }

/**
 * strict 之下，什麼算「這一列沒寫成」。
 *
 * `undefined`（沒有 sink）與 `null`（舊版 `writeAuditEntry` 的失敗回傳）都算
 * 失敗。先前它們算成功，於是把 sink 接成舊版 helper、或根本不接 sink，
 * 都會讓 fail-closed 靜默失效——而 `AuditSinkResult` 的型別明文接受這兩種形狀，
 * 等於主動邀請這個錯誤。沒有稽核與稽核寫失敗，對 strict 是同一件事。
 */
function auditSinkFailed(result: AuditSinkResult): boolean {
  if (result === null || result === undefined) return true
  if (typeof result === 'string') return false
  return auditWriteFailed(result)
}

export interface RunEsRequestOptions {
  /**
   * The configured tier. Required and undefaulted: a default here would be the
   * bypass this parameter exists to close, and it would be invisible at every
   * call site that forgot to pass one.
   */
  permission: Permission
  audit?: EsShellAuditSink
  /**
   * `config.audit.strict`。開啟時，送出前那一列 audit 寫不出去就拒絕執行。
   *
   * 只管 `attempt` 那一列。理由對執行後的 `outcome` 成立——請求已經在叢集上，
   * 擋也擋不回來。但被權限或 blacklist 拒絕的請求也只寫 `outcome`，而它從未
   * 上叢集：那一列寫不出去時，稽核同樣不存在，只是 fail-closed 在那裡沒有東西
   * 可擋（請求本來就沒送出）。這個範圍是刻意的，不是論證涵蓋到了。
   */
  strictAudit?: boolean
}

/**
 * Everything about a request that every check below reads: the parsed target,
 * the routed path, the index it names, the shape handed to the classifier, and
 * the two audit fields derived from them.
 *
 * Derived once, in one place, because the defect this file kept producing was
 * two checks reading two different spellings of the same request.
 */
function describeEsRequest(req: EsRequest): {
  target: { url: URL; canonical: string } | null
  query: URLSearchParams
  routedPath: string
  index: string | undefined
  esRequest: { method: string; rawPath: string; body: string | undefined }
  tierOverride: 'db-write' | undefined
  auditTarget: string
  auditStatement: string
} {
  // Resolved first: `/%5Fsearch` is `/_search`, `/secrets%2F_search` is
  // `/secrets/_search`, and `/_cat/../secrets/_search` resolves to
  // `/secrets/_search`. Checking the raw text answers a question about a
  // request the server will never see.
  // Parsed once, by the parser the request will go through. `req.path.split('?')`
  // was here, and `String.split` splits at *every* `?` while the destructuring
  // took only the second element — so everything after a second `?` vanished
  // from the query these checks read, while the adapter was handed the path
  // whole. `?filter_path=x?&source=<body>` therefore hid a smuggled request body
  // from every check that exists to find one.
  //
  // This is round three's lesson one field over: the path stopped being
  // approximated and the query string did not.
  const target = parseRequestTarget(req.path)
  const query = target?.url.searchParams ?? new URLSearchParams()
  // `normalizeEsPath` decodes, which is right for reading an index *name* and
  // wrong for deciding where a request routes. The classifier answers the
  // second question with the URL parser; this answers the first.
  const routedPath = normalizeEsPath(target?.url.pathname ?? req.path)
  const index = extractIndexFromPath(routedPath)

  // `_bulk` is classified from its NDJSON body, which arrives here already
  // parsed, so it goes back to text for the classifier rather than the
  // classifier growing a second input shape.
  const bodyText =
    req.body === undefined
      ? undefined
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)
  const esRequest = { method: req.method, rawPath: req.path, body: bodyText }

  // Classified once for the audit tier, which has to be recorded whether the
  // request is executed or refused. Recording the command's capability tier
  // instead — what the audit helper defaults to — files every shell entry under
  // one label and is a known defect: the same destructive operation ended up
  // audited as three different tiers depending on which command reached it.
  const classification = classifyElasticsearchRequest(esRequest)
  const tierOverride = classification.type === 'SELECT' ? undefined : ('db-write' as const)

  // The sink's own errors are not this request's outcome. `writeAuditEntry`
  // swallows its failures today, but the sink is an injected interface: one
  // that rejected would replace a PermissionError with an audit error on the
  // failure path, and on the success path would report an executed mutation to
  // the operator as a failure while logging it as one.
  // `extractIndexFromPath` returns undefined for every `_`-leading path, so
  // `POST /_bulk`, `_msearch`, `_mget` and every `_cat` request audited with no
  // target at all — and the entry carries no statement either, so a bulk write
  // against the cluster produced a row naming neither the operation nor the
  // object. The routed path is the object when no index can be named.
  const auditTarget = index ?? routedPath
  const auditStatement = `${req.method.toUpperCase()} ${routedPath}`
  return {
    target,
    query,
    routedPath,
    index,
    esRequest,
    tierOverride,
    auditTarget,
    auditStatement,
  }
}

/**
 * The per-request audit writer. A closure over the sink and the fields every
 * row carries, so a caller cannot write a row that names one and not the other.
 */
function createAuditRecorder(
  options: RunEsRequestOptions,
  fields: { target: string; statement: string; tierOverride: 'db-write' | undefined }
): (phase: 'attempt' | 'outcome', success: boolean, error?: unknown) => Promise<AuditSinkResult> {
  return async (phase, success, error) => {
    if (!options.audit) return undefined
    try {
      return await options.audit({
        phase,
        success,
        error,
        target: fields.target,
        statement: fields.statement,
        tierOverride: fields.tierOverride,
      })
    } catch {
      // The sink's own errors are not this request's outcome — but a sink that
      // threw did not record anything either, so strict mode must see it.
      return { skipped: 'write-failed', error: 'audit sink threw' }
    }
  }
}

/**
 * Enforce the permission tier and the index blacklist, cap a search, then issue
 * the request.
 *
 * The permission check is new. `dbcli shell` forks to this module before
 * reaching the gate that covers its SQL and Redis branches, so a `query-only`
 * connection could delete every document in an index, drop the index, or
 * rewrite its mapping — each of them refused when the same request goes through
 * `dbcli query`. The classifier below is the one `query` uses; the shell hands
 * it the real method and path, where `query` can only synthesise a search.
 */
export async function runEsRequest(
  req: EsRequest,
  adapter: EsRequestCapable,
  blacklistTables: string[],
  blacklistColumns: Record<string, string[]> = {},
  options: RunEsRequestOptions
): Promise<unknown> {
  const { target, query, routedPath, index, esRequest, tierOverride, auditTarget, auditStatement } =
    describeEsRequest(req)
  const audit = createAuditRecorder(options, {
    target: auditTarget,
    statement: auditStatement,
    tierOverride,
  })

  try {
    return await execute()
  } catch (error) {
    await audit('outcome', false, error)
    throw error
  }

  async function execute(): Promise<unknown> {
    assertRequestTargetIsCanonical(req, target)
    assertNoSmuggledBody(req, query, routedPath)

    // The tier gate, which this path did not have. It runs before the blacklist
    // because it is the coarser question: whether this caller may perform this
    // kind of operation at all, on any object. Unconditional — the gate below
    // is not.
    enforceElasticsearchPermission(esRequest, options.permission)

    if (blacklistIsConfigured(blacklistTables, blacklistColumns)) {
      assertNoBlacklistedIndexNamed({ req, routedPath, index, blacklistTables })
    }

    return send()
  }

  async function send(): Promise<unknown> {
    const protectedFields = collectProtectedFields(blacklistColumns)
    assertNoProtectedFieldNamed(req, query, protectedFields)
    const body = capSearchSize(req)

    // Before the socket, not after: from here on the cluster may act on this
    // request whatever happens to this process, so a record that only exists on
    // the way back cannot describe a request that never comes back.
    //
    // 「寫下去了」的強度到 page cache 為止：`AuditLogger` 用 `appendFile`
    // 且刻意不做 fsync（D-08）。斷電或 kill -9 之下這一列仍可能不存在。
    // strict 把這條路徑從 best-effort 提升為控制，但提升不到硬體那一層。
    //
    // `success: false`, always. At this point the operation has not succeeded —
    // it may not even leave the process, because the transport applies the
    // server-side script check. Writing `true` here made "not sent" and "sent
    // and succeeded" the same row, and doubled every success count. The truth
    // is the `outcome` row's job; this row's job is to exist.
    const attempt = await audit('attempt', false)
    if (options.strictAudit && auditSinkFailed(attempt)) {
      // 稽核是這條路徑上的控制本身，不是佐證。寫不出來就等於沒有控制。
      throw new Error(t('shell.es.refuse_audit_strict'))
    }
    const response = await adapter.request(req.method, req.path, body)
    await audit('outcome', true)

    // `dbcli query --index users` hides these fields; the shell returned them in
    // full because it never consulted `blacklist.columns`. An Elasticsearch
    // response is an arbitrary document shape, so rather than model `hits.hits`
    // and every other envelope, any key matching a protected field name is
    // removed wherever it appears. That over-masks — a metadata key of the same
    // name goes too — which is the direction that does not disclose.
    return protectedFields.size === 0 ? response : redactFields(response, protectedFields)
  }
}

/** The banner. Written to stderr so a piped session's stdout carries only responses. */
function printEsShellBanner(): void {
  console.error(pc.bold(t('shell.es.banner_title')))
  console.error(pc.dim(t('shell.es.banner_hint')))
  console.error(pc.dim(t('shell.es.banner_keys')))
  console.error('')
}

interface EsShellSession {
  adapter: EsRequestCapable & { disconnect(): Promise<void> }
  blacklistTables: string[]
  blacklistColumns: Record<string, string[]>
  permission: Permission
  config: Awaited<ReturnType<typeof configModule.read>>
  configPath: string
}

/**
 * Run one submitted block: parse it, issue it, print the response.
 *
 * Returns whether it succeeded — the caller turns that into the session's exit
 * code, which a piped caller reads and a human does not.
 */
async function executeEsBlock(block: string, session: EsShellSession): Promise<boolean> {
  const { adapter, blacklistTables, blacklistColumns, permission, config, configPath } = session
  try {
    const req = parseEsRequest(block)
    const res = await runEsRequest(req, adapter, blacklistTables, blacklistColumns, {
      permission,
      strictAudit: config.audit?.strict ?? false,
      audit: (record) =>
        writeAuditEntryResult(
          config,
          'shell',
          { config: configPath },
          {
            success: record.success,
            error: record.error,
            target: record.target,
            // 操作本身。少了它，`DELETE /orders` 與 `PUT /orders/_mapping`
            // 在紀錄裡是同一列。
            sql: record.statement,
            sideEffectTier: record.tierOverride,
            metadata: { es_shell_phase: record.phase },
          }
        ),
    })
    console.log(JSON.stringify(res, null, 2))
    return true
  } catch (error) {
    // 訊息內嵌使用者寫的路徑，而路徑可以帶 `ESC[2K ESC[1G`——那會清掉整行並把
    // 游標移回行首，用後續字元蓋掉「Refused」，讓操作者看到一則自己寫的假成功
    // 訊息。audit 檔（JSONL）與 `audit tail`（表格）都已經處理這件事，
    // 唯獨 shell 自己的 stderr 沒有。
    console.error(pc.red(escapeControlCharacters((error as Error).message)))
    return false
  }
}

/**
 * Read the configuration, open the connection, and assemble everything a
 * request needs from it.
 *
 * `runShell` forks to this module before the branch that gates SQL and Redis,
 * so this is the only place the configured tier can enter the Elasticsearch
 * path — which is why the wiring has a test of its own.
 */
async function openEsShellSession(configPath: string): Promise<EsShellSession> {
  const config = await configModule.read(configPath)
  const adapter = AdapterFactory.createElasticsearchAdapter(config.connection as ConnectionOptions)
  await adapter.connect()
  return {
    // `createElasticsearchAdapter` is typed as the shared `QueryableAdapter`,
    // which does not declare `request()`. The cast is here, once, at the seam —
    // rather than at every call, which is where it used to be as `as never`.
    adapter: adapter as unknown as EsShellSession['adapter'],
    blacklistTables: config.blacklist?.tables ?? [],
    blacklistColumns: (config.blacklist?.columns ?? {}) as Record<string, string[]>,
    permission: resolveEsShellPermission(config),
    config,
    configPath,
  }
}

/**
 * The read loop.
 *
 * Longer than the 50-line guideline in CONTRIBUTING.md, deliberately: what is
 * left after the session, the banner and the per-block work moved out is a
 * state machine over three pieces of mutable state (`blockLines`, `closing`,
 * `failed`) shared by four readline handlers. Splitting it further spreads that
 * state across functions, and ADR-0014 pins where each piece may be read —
 * `blockLines` only in the `'line'` handler that fills it, the drain only in
 * `'close'`. Fewer lines there would cost the property the conditions protect.
 */
export async function runEsShell(configPath: string): Promise<void> {
  const session = await openEsShellSession(configPath)
  const { adapter } = session

  printEsShellBanner()

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: pc.cyan('es> '),
    terminal: process.stdin.isTTY ?? false,
  })

  let blockLines: string[] = []
  // block 在**排入佇列的當下**取快照，不是在任務跑起來時才讀 `blockLines`。
  // readline 會把管線送來的行在同一個 tick 全部同步發完，所以「跑起來時才讀」
  // 等於把快照推遲到微任務之後，中間的行會灌進同一個 buffer：兩個命令被合併
  // 成一個 block（於是一個都沒送出），而互動模式下還沒打空行提交的內容會被
  // 當成前一筆的 body 送進叢集。
  //
  // 這也讓 SIGINT 只清得到未提交的行——`blockLines` 之後不再裝已提交的 block。
  // `exit` 之後不再對叢集做任何事。
  //
  // `'line'` handler 在同一個 tick 把管線的所有行同步 enqueue 完，而 `exit` 的
  // `rl.close()` 要等它自己那個任務跑起來才執行——此時後面的 block 早已在鏈上，
  // 而 `'close'` 的 `drain()` 語意是「排空」，於是會把它們全部執行完。
  // 旗標同時擋住「還沒 enqueue 的」與「已經排隊的」兩邊。
  let closing = false
  // 任何一筆被拒絕或失敗，退出碼就不是 0。
  //
  // 先前一律 `exit(0)`，所以 `dbcli shell < script.txt` 的呼叫端分不出「全部
  // 成功」與「一條都沒跑」——權限拒絕、blacklist 拒絕、strict-audit 拒絕全部
  // 只印一行紅字就結束。對人來說看得見，對自動化來說不存在。
  let failed = false
  const submit = async (block: string) => {
    if (closing) return
    if (block === '') return
    if (block === 'exit' || block === 'quit') {
      closing = true
      rl.close()
      return
    }
    // `failed` is set in a `finally`, not after the call returns. If
    // `executeEsBlock` throws on its way out — `console.error` onto a closed
    // stderr pipe is the realistic one — the submit queue swallows the
    // rejection, and setting the flag afterwards would leave a session that
    // refused a request exiting `0`.
    let ok = false
    try {
      ok = await executeEsBlock(block, session)
    } finally {
      if (!ok) failed = true
    }
  }

  // readline 不 await 這個 handler，`'close'` 也不會等它——管線輸入下請求送得出去
  // 而 audit 寫不完，就是第五輪那個稽核逃逸。佇列同時管序列化與排乾。
  const queue = createSubmitQueue()

  rl.prompt()
  rl.on('line', (line: string) => {
    if (closing) return
    // 提交的是**真正的空行**，不是 `trim()` 之後為空的行。
    //
    // 編輯器很容易在空行留下空白，而 `trim()` 讓那種行等同於提交：貼進一段
    // `POST /orders/_update_by_query` 加一行兩個空白加 body，前半段會以一個
    // **沒有 body** 的請求送出——而 `_update_by_query` 沒有 body 是合法的，
    // 作用範圍是整個 index。使用者只看到後半段的格式錯誤，而 audit 寫下的字串
    // 與他本來要送的那筆逐字相同，事後查不出差別。
    //
    // 反方向的代價是：分隔行若帶著空白，管線裡的命令會黏成一塊而解析失敗。
    // 那個失敗是可見的、而且什麼都不會送出——fail-closed，與上面那個
    // fail-open 不對稱，所以取這一邊。
    if (line.replace(/\r$/, '') === '') {
      const block = blockLines.join('\n').trim()
      blockLines = []
      rl.setPrompt(pc.cyan('es> '))
      queue.enqueue(() => submit(block))
    } else {
      blockLines.push(line)
      rl.setPrompt(pc.dim('...  '))
    }
    rl.prompt()
  })
  rl.on('SIGINT', () => {
    blockLines = []
    rl.setPrompt(pc.cyan('es> '))
    console.error(pc.dim(t('shell.es.block_cancelled')))
    rl.prompt()
  })
  rl.on('close', async () => {
    // 排乾必須在 disconnect 與 exit 之前：在飛的請求要落地，audit 要寫完。
    await queue.drain()
    await adapter.disconnect()
    console.error(pc.dim(t('shell.es.goodbye')))
    process.exit(failed ? 1 : 0)
  })
}

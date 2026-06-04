# dbcli 觀察型資料庫 Proxy 設計

- **日期**: 2026-06-04
- **狀態**: 設計待實作(brainstorming 完成,待 writing-plans)
- **目標版本**: 未定(產品版號以 package.json 為準)
- **相關方向**: 讓既有本機專案不改應用程式碼,改連 dbcli 本機 proxy port,由 dbcli 在資料庫 wire protocol 中間透明轉發並收集效能、錯誤、SQL 使用與反向工程線索。

---

## 1. 問題與目標

開發者常有既有專案直接連本機 MySQL、MariaDB 或 PostgreSQL。當需要分析效能、理解資料存取模式、逆向工程 schema usage 或找出慢查詢時,目前 dbcli 只能觀察自己執行的 command,看不到外部應用程式透過原本 database driver 送出的流量。

本功能新增 `dbcli proxy`: 一個 local development observability proxy。應用程式改連 dbcli 監聽的本機 port,dbcli 再轉發到真正資料庫。第一版只觀察,不改寫、不阻擋、不儲存 result row data。

### 成功標準

- 支援 MySQL、MariaDB、PostgreSQL 的最小可用本機 wire proxy。
- 外部 app 使用原 database driver 連 proxy,普通 query / transaction smoke path 可轉發到真 DB。
- Proxy 轉發是主路徑;protocol analyzer 失敗不得中斷連線。
- 事件 append-only 寫入 `.dbcli/proxy/events.jsonl`,terminal 僅顯示精簡狀態與告警。
- 第一版明確標示相容性邊界: TLS、prepared/binary protocol、auth/plugin edge cases 均非完整生產級承諾。

---

## 2. 範圍

### v1 收錄

- `dbcli proxy` command group。
- Engine: MySQL、MariaDB、PostgreSQL。
- 啟動方式同時支援:
  - 顯式指定上下游: `--listen` + `--target`。
  - 從 dbcli config / `--use` 推斷 target engine、host、port,CLI flags 可覆蓋。
- Observe-only event collection:
  - session lifecycle。
  - query observed / completed / errored。
  - latency、request bytes、response bytes。
  - SQL text best-effort capture。
  - statement type、tables best-effort extraction。
  - parse errors。
- `--slow-ms` terminal slow-query warning。
- `--redact none|literals`,以 literal redaction 支援較安全的本機分析。

### v1 不做(YAGNI)

- Production database gateway。
- SQL rewrite、auto-limit、trace comment injection。
- Permission / blacklist enforcement。
- Result row capture。
- TLS 解密或 MITM。
- Connection pooling / load balancing / failover。
- 完整保證 MySQL prepared/binary protocol 或 PostgreSQL extended query protocol 參數還原。
- 把 proxy events 混入既有 dbcli audit log。

---

## 3. 指令介面

### 3.1 顯式上下游

```
dbcli proxy mysql --listen 127.0.0.1:3307 --target 127.0.0.1:3306
dbcli proxy mariadb --listen 127.0.0.1:3307 --target 127.0.0.1:3306
dbcli proxy postgresql --listen 127.0.0.1:5433 --target 127.0.0.1:5432
```

### 3.2 Config 推斷

```
dbcli proxy --use local --listen 127.0.0.1:3307
```

### 3.3 Options

```
--listen <host:port>       Local proxy listen address. Required.
--target <host:port>       Upstream DB target. Optional when config provides host/port.
--events <path>            Event JSONL path. Default: .dbcli/proxy/events.jsonl.
--slow-ms <number>         Slow query terminal warning threshold. Default: 1000.
--redact none|literals     SQL redaction mode. Default: none.
--format text|json         Runtime status output format. Default: text.
```

解析規則:

- Subcommand `mysql|mariadb|postgresql` 明確指定 engine。
- 沒有 subcommand 時,從 `--use` / config connection 的 `system` 推斷 engine。
- `--target` 省略時,從 config connection 的 `host` / `port` 推斷。
- `--listen` 必填,避免不小心占用真 DB port。
- `--events` 預設寫入目前專案的 `.dbcli/proxy/events.jsonl`。

---

## 4. 架構

第一版採「TCP byte-stream relay + 旁路 protocol analyzer」。可靠轉發是核心,分析是 best-effort。

```
App DB driver -> dbcli local proxy -> real DB
                  |             |
                  v             v
              analyzer      byte relay
                  |
                  v
        .dbcli/proxy/events.jsonl
```

### 4.1 模組

| 檔案 | 職責 |
|---|---|
| `src/commands/proxy.ts` | Commander command group, config / flag resolution, status output |
| `src/proxy/server.ts` | TCP listener, session lifecycle, upstream connection creation |
| `src/proxy/relay.ts` | Bidirectional byte forwarding, byte counters, close/error handling |
| `src/proxy/events.ts` | Event types, JSONL writer, event redaction boundary |
| `src/proxy/analyzers/types.ts` | Shared analyzer interface and packet direction model |
| `src/proxy/analyzers/mysql.ts` | MySQL/MariaDB packet best-effort analyzer |
| `src/proxy/analyzers/postgresql.ts` | PostgreSQL packet best-effort analyzer |
| `src/proxy/sql-metadata.ts` | Statement/table extraction and literal redaction |

### 4.2 Relay-first contract

- `TcpRelay` forwards bytes regardless of analyzer state.
- Analyzer exceptions are caught and emitted as `parse_error` events.
- Unsupported packets are tagged rather than blocked.
- Session close should flush pending query/error/session events before process exit where practical.

---

## 5. Event Schema

Events are append-only JSON objects, one per line, under `.dbcli/proxy/events.jsonl` by default.

```ts
type ProxyEvent =
  | ProxyStartedEvent
  | SessionStartedEvent
  | SessionEndedEvent
  | QueryObservedEvent
  | QueryCompletedEvent
  | QueryErroredEvent
  | ParseErrorEvent
```

Representative `query_completed` event:

```json
{
  "version": 1,
  "type": "query_completed",
  "timestamp": "2026-06-04T12:00:00.000Z",
  "engine": "mysql",
  "sessionId": "pxy_...",
  "queryId": "qry_...",
  "client": "127.0.0.1:51234",
  "target": "127.0.0.1:3306",
  "sql": "SELECT * FROM users WHERE id = ?",
  "statement": "SELECT",
  "tables": ["users"],
  "durationMs": 12.4,
  "requestBytes": 84,
  "responseBytes": 2048,
  "rowCount": 1,
  "error": null,
  "tags": ["prepared_statement"]
}
```

Core event fields:

- `version`: Event schema version, starting at `1`.
- `type`: Event kind.
- `timestamp`: ISO timestamp.
- `engine`: `mysql`, `mariadb`, or `postgresql`.
- `sessionId`: Stable id for one client/upstream connection pair.
- `queryId`: Stable id for one observed query lifecycle when known.
- `client` / `target`: `host:port` strings.
- `sql`: SQL text when visible and parseable.
- `statement`: Statement type when inferred.
- `tables`: Table names when inferred.
- `durationMs`: Query or session duration depending on event type.
- `requestBytes` / `responseBytes`: Byte counts.
- `rowCount`: Best-effort row count when inferable from server protocol.
- `error`: Parsed database error when available.
- `tags`: Compatibility and inference notes, such as `prepared_statement`, `tls_unparsed`, `extended_protocol`, or `parse_partial`.

---

## 6. 分析能力與限制

### 6.1 MySQL / MariaDB

Must support:

- Basic handshake passthrough.
- `COM_QUERY` SQL capture.
- ERR packet code/message capture.
- Query duration from client query packet to response completion when packet boundaries are inferable.

Best effort:

- Prepared statement lifecycle tags.
- Row count / response completion inference.
- Auth plugin / capability flags observation.

### 6.2 PostgreSQL

Must support:

- Startup message passthrough.
- Simple Query message SQL capture.
- ErrorResponse code/message capture.
- Query duration from client query message to response completion when message boundaries are inferable.

Best effort:

- Extended query protocol tags (`Parse`, `Bind`, `Execute`, `Sync`).
- Prepared statement name and SQL association when visible.
- Row count / command completion inference.

### 6.3 TLS behavior

TLS is not decrypted in v1. If a client negotiates encrypted traffic through the proxy, dbcli still relays bytes and records session/byte events, but SQL/event analysis is limited to `tls_unparsed` tags and parse-error-safe metadata.

Docs should recommend disabling SSL for local analysis sessions when SQL visibility is required.

---

## 7. Privacy And Safety

- Default behavior stores SQL text but never result rows.
- `--redact literals` replaces string and numeric literal values before writing SQL to events.
- `--redact none` remains useful for local performance diagnosis and reverse engineering.
- Proxy events are separate from dbcli audit logs because audit records dbcli-initiated operations, while proxy events record external application traffic.
- Observe-only v1 avoids surprising app behavior: no SQL blocking, no rewriting, no injected comments.

---

## 8. 錯誤處理

| 情境 | 行為 |
|---|---|
| Listen address invalid | Command exits with config/validation error |
| Target unavailable at startup or first connect | Client session receives connection failure; event records upstream error when possible |
| Analyzer throws | Relay continues; emit `parse_error` |
| Unsupported engine in config | Command exits with "proxy supports mysql, mariadb, postgresql" |
| TLS traffic | Relay continues; emit session/query metadata only with `tls_unparsed` tag |
| Event file write error | Print terminal error and stop accepting new sessions; avoid silently running unobservable |
| Client disconnect | Close upstream, emit `session_ended` |
| Upstream disconnect | Close client, emit `session_ended` |

---

## 9. 測試策略

### 單元測試

- Listen / target parser.
- Config + flag resolution.
- Event writer directory creation and JSONL append.
- SQL literal redaction.
- SQL metadata extraction for common SELECT / INSERT / UPDATE / DELETE / JOIN shapes.
- Analyzer fixtures:
  - MySQL `COM_QUERY`。
  - MySQL ERR packet。
  - PostgreSQL simple Query。
  - PostgreSQL ErrorResponse。

### Relay tests

- Fake upstream TCP server verifies client-to-server bytes are forwarded unchanged.
- Fake upstream TCP server verifies server-to-client bytes are forwarded unchanged.
- Analyzer exception does not stop relay.
- Byte counters and session ended events are emitted.

### Integration tests

- Docker MySQL smoke: app driver -> proxy -> DB -> `SELECT 1`。
- Docker MariaDB smoke: app driver -> proxy -> DB -> `SELECT 1`。
- Docker PostgreSQL smoke: app driver -> proxy -> DB -> `SELECT 1`。
- Slow-query threshold produces terminal warning and event duration.
- Events file contains session + query lifecycle for smoke query.

### Docs / static checks

- `bun test` targeted proxy tests during implementation.
- `bun run typecheck` after implementation.
- `bun run lint` after implementation.
- `bun run docs:check` after user docs updates.

---

## 10. 文件與發布(完工後)

依 AGENTS.md Documentation Mandate,實作完成後必須同步:

- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`

文件需包含:

- 本機 app 如何改連 proxy port。
- MySQL/MariaDB/PostgreSQL examples。
- JSONL event examples。
- `--redact literals` 隱私建議。
- TLS / prepared / extended protocol limitations。
- 明確標示 v1 是 local development observability proxy,不是 production gateway。

可視實作範圍再同步:

- `README.md`
- `README.zh-TW.md`
- `assets/SKILL.md`
- `assets/SKILL.zh-TW.md`
- `assets/reference.md`
- `CHANGELOG.md`

---

## 11. 後續版本候選

- `dbcli proxy report`: 從 JSONL 產生 slow queries、hot tables、error rate、N+1 hints。
- `dbcli proxy analyze`: 生成 schema usage / reverse-engineering summary。
- `--enforce-policy`: opt-in permission / blacklist blocking。
- TLS termination for explicitly configured local certificates。
- More complete prepared / binary / extended protocol reconstruction。
- OpenTelemetry export。

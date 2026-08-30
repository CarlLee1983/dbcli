# Changelog

All notable changes to dbcli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2026-08-30 - Elasticsearch 的 shell 從來沒有問過 permission

**建議所有把 Elasticsearch 連線交給 AI agent 操作的使用者升級。** `dbcli shell` 連到 Elasticsearch 時，完全沒有檢查連線設定的 permission 等級就把請求送到叢集：`shell.ts` 在到達 SQL 與 Redis 共用的那道閘門之前就分支到 `es-shell.ts`。因此 `permission: query-only` 的連線可以送出 `POST /<index>/_delete_by_query` 清空索引、`DELETE /<index>` 刪掉索引、`PUT /<index>/_mapping` 改寫 schema —— 同樣這些請求走 `dbcli query` 一律會被拒絕。這條路徑也不寫任何 audit 紀錄，所以受影響的人事後無從查證發生過什麼。

它可以腳本化：shell 用管線餵入的 stdin 驅動與互動輸入相同的迴圈，所以一個 agent 用單一非互動指令就能做到上述任何一項。

影響範圍是所有 Elasticsearch 連線，`1.22`（ES shell 首次出現）起至 `3.0.0` 止。SQL、Redis、MongoDB 的 shell 不受影響 —— 它們走的是有閘門的那一條分支。沒有任何生產事故的紀錄，但這是從缺席推論出來的，而這條路徑本來就不寫 audit，受影響的操作者本來就無從發現。

### Fixed

- **BREAKING（對 `query-only` 與 `read-write` 的 Elasticsearch shell 使用者而言）：ES shell 現在套用連線的 permission 等級。** 請求由 `dbcli query` 使用的同一個分類器判定 —— shell 交給它的是真正的 method 與 path，而 `query` 只生得出一個合成的 `_search`。無法證明是文件層級的操作一律落到需要 `admin` 的那一級：`DELETE /<index>`、`DELETE /_all`、`_delete_by_query`、`PUT /_mapping`、`PUT /_settings`、`POST /_aliases`、`POST /_reindex`。拒絕訊息會指出可行的等級，而且請求不會送出。先前能在 `query-only` 下跑這些請求的人，現在會被擋。

- **ES shell 的每個請求都寫入 audit，執行或被拒都寫。** side-effect tier 取自該請求的分類結果而非發起它的命令 —— 用命令的能力表來標記是一個已知缺陷，同一個破壞性操作曾因為經由不同命令而被記成三種不同的 tier。

- **分類器改讀伺服器實際路由的路徑。** 先前它拿到的是原始文字（含 query string），而黑名單拿到的是去掉 query string 的路徑。分類器裡每個子字串比對因此都會命中攻擊者控制的參數值，而 `filter_path` 是每個端點都接受、且吃任意字串的通用參數：`POST /<index>/_delete_by_query?filter_path=_count` 判成搜尋、`DELETE /<index>?filter_path=_bulk` 判成搜尋、`PUT /<index>/_mapping?filter_path=_bulk` 判成搜尋，三者都在 `query-only` 下實測執行成功。現在 query string 被丟棄、百分比編碼與 dot segment 在分類前解析，欄位也從 `apiPath` 改名為 `rawPath` 並在模組內正規化，呼叫端不可能再傳錯一個。

- **比對改為位置感知的路徑區段，不再是子字串。** `_search`、`_count`、`_bulk` 都是合法的文件 id，所以精確區段比對本身也不夠：`POST /<index>/_doc/_search` 是「索引＋id」的寫入請求，最後一段卻是 `_search`。`_search` 與 `_count` 只在一段或兩段路徑的端點位置才算數，文件 id 一律不透明、永不參與比對。

- **Elasticsearch 的讀取判定維持白名單，並補上讓它不堪用的那幾個形狀。** 新增 `_cat/*`（不含 `_cat/aliases` 與 `_cat/tasks`）、`_cluster/health`、`GET`／`HEAD` 裸索引名稱。其餘一律落到需要 `admin` 的預設 —— 包含任何沒被列上的端點。這個方向是刻意的：白名單漏一項，使用者多付一個不必要的 admin 要求；拒絕集漏一項，使用者拿到一個繞過。記在 ADR-0014。

- **`_bulk` 的 body 無法辨識或無法解析時判為 `DROP`。** 先前判 `SELECT`，而 bulk 分支由路徑單獨選中，所以那是一個通用的降級管道。

- **路徑必須與 URL parser 產出的字串逐位元組相同，否則一律拒絕**，而拒絕訊息會給出正確的寫法。dbcli 原本有一套自己的「路由後路徑」概念，它在*近似* `fetch` 的行為——而近似的價值等於它最糟的那個缺口。`#` 就是一個：`fetch` 會丟棄第一個 `#` 之後的一切，所以 `POST /_reindex#/_count` 在 dbcli 眼中是兩段的 count、伺服器收到的卻是 `POST /_reindex`，那是任意索引對拷，因此同時也是黑名單繞過——把受保護的索引拷進可讀的索引再正常讀。tab、換行與 `\` 是同一形狀的另外三個缺口。現在改問傳輸層用的同一個 parser，adapter 也改用它組 URL，所以驗證過的字串就是送出的字串。

- **`source` query 參數一律拒絕。** Elasticsearch 接受 `source=<json>&source_content_type=...` 取代 request body，而這條路徑上每個 body 側檢查都讀 `req.body` —— 被保護的欄位名稱寫在偷渡的 body 裡時，那個為此存在的檢查完全看不到。參數以精確鍵名比對，`_source`、`_source_includes`、`_source_excludes` 不受影響。

- **黑名單欄位名稱在 query string 裡也會被拒絕**，因為 URI search 形式直接在參數裡指名欄位（`?q=password:*`、`?sort=password:asc`、`?docvalue_fields=`），而值會以請求自選的 key 回傳。

- **引號字串形式的 request body 一律拒絕。** JSON 字串字面值是合法的 body，卻能挾帶 NDJSON 通過每一個只走物件與陣列的檢查 —— 一個 bulk delete 曾因此從無害的路徑名稱抵達黑名單索引。

- **`_ingest` 與 `_tasks` 移出 shell 的 unscoped metadata 白名單**：pipeline 定義常內嵌憑證，詳細 task 列表會帶出執行中查詢的 request source。

- **`_update_by_query` 從 `read-write` 收緊為 `admin`**：它是獨立的區段，精確比對之下落到破壞性預設，而它確實會改寫索引裡的每一份文件。

## [3.0.0] - 2026-08-16 - Evidence that could not reproduce itself, and a hash that hid nothing

The evidence subsystem shipped in v1.53.0 and, until this week, nobody had composed a pack outside its own tests. The first real use — a `verify safe-backfill --after-write` against a live PostgreSQL — came back `not_verified` on data that was correct, and the audit that followed found three more defects of the same kind: an evidence pack whose digest covered a random UUID, so the same claims never produced the same pack twice; a receipt "fingerprint" that was an unsalted SHA-256 over eight possible values; and a blacklist comparison with no identifier boundaries, so a protected column named `id` refused any claim containing the word "identifier". Fixing them changes both published formats, which is what makes this a major release: **packs written by 2.x will fail validation under 3.0.0, and `observation.fingerprint` no longer exists.** The reversal that authorized the repairs — known defects get fixed whether or not anyone is using the code — is recorded in `docs/adr/0012-known-defects-get-fixed-whether-or-not-anyone-is-using-the-code.md`, superseding ADR 0011.

### Changed

- **BREAKING: an evidence pack's digest now covers only its content, so equivalent input produces the same pack.** The digest was taken over the whole pack including `id`, which was `evp_${randomUUID()}`, and a millisecond `createdAt` — so composing the same claims twice yielded two unrelated digests and cross-run comparison was not merely hard but undefined. The digest now covers `version` / `subject` / `claims`; `id` is derived from its first 32 characters, so equivalent input yields an identical pack down to the identifier, and `parse` checks that the two agree. `createdAt` sits outside the digest and is documented, in the type and in `reference.md`, as the one field that can be restamped without breaking verification — leaving that unsaid would be selling tamper-evidence that isn't. `canonicalizeWithoutDigest` was `JSON.stringify`, so "canonical" rested on the build and parse paths hand-maintaining the same key insertion order; it is now a real canonicalization that sorts keys recursively. The format is changed in place with no v2 fallback and no compatibility layer: existing packs fail validation, which is correct, because their digests were computed under rules that no longer hold (#116).

- **BREAKING: a receipt states its observation instead of hashing it.** `observation.fingerprint` was an unsalted SHA-256 over a preimage space of eight values for `verify` (four `VerificationStatus` × an `artifactPersisted` boolean) and 2^(n+1) for an `assert` with n checks, in a fixed public serialization — a dictionary attack measured in milliseconds. Everything it covered already appeared in plaintext in `outcome`, so the only thing it protected was the per-check pass bit pattern, and the only reader it stopped was an honest one; being deterministic, it also let receipts be grouped by result across files, which is the property the old test suite was asserting. `verify` now records `{ kind: 'verify-outcome', status }` and `assert` records `{ kind: 'assert-verdict', checksPassed, checksTotal }` — counts, not positions, so *which* check failed still does not leave the receipt, and less leaks than before, since anyone willing to invert the old hash recovered the full bit pattern. `parseObservation` validates the field shape per operation and rejects `checksPassed > checksTotal` (#118).

- **`evidence` no longer means three incompatible things.** `VerificationStatus` (`verified` / `not_verified` / `indeterminate` / `blocked`), `EvidenceItem.status` (`ok` / `no-data` / `skipped` / `error` / `timeout`) and `WorkloadEvidence.state` (`available` / `absent` / `invalid` / `unavailable`) are a verdict on a subject, whether a diagnostic ran, and whether a source file is usable — three vocabularies that cannot be mapped onto each other, all filed under one word, all string unions the type system cannot keep apart. `EvidenceItem` is now `ReportFinding` and `WorkloadEvidence` is `WorkloadSource` (with `WorkloadEvidenceState`, `LoadWorkloadEvidenceOptions`, `loadWorkloadEvidence` and the command layer's `loadObservedWorkloadEvidence` renamed to match). The values are unchanged and `VerificationStatus` is untouched, being part of a published JSON contract. `CONTEXT.md` gains an "Outcome vocabularies" section stating that they do not map — but the rename is what stops the mistake at the call site, since nobody reads `CONTEXT.md` while writing a comparison (#114).

### Added

- **`scripts/check-plan-acceptance.ts` makes an acceptance criterion say whether anything proved it.** The 2026-08-08 backlog's eight tickets shipped with v1.53.0 and still read `Status: Proposed`, and two of their criteria described behavior the code structurally could not produce. Nothing caught either, because plan documents are prose and prose drifts silently. Every numbered acceptance criterion under `docs/plans/*.md` must now end in `— covered by:` (naming a test file that exists), `— unverified:` (admitting nothing proves it), or `— known deviation:` (deliberately unmet, with a reason). The gate forces disclosure, not coverage — marking all thirty criteria `unverified` would pass — because a gate demanding real tests gets nagged into a rubber stamp, while the count stays visible in review, and eighteen of thirty unverified is its own pressure. The one substantive check is that a cited test file exists, that being the half that is cheap to check and the failure mode the gate exists to stop; prose criteria with no numbered list count as a violation, so reformatting cannot route around it. `docs/plans/done/` is not scanned, since rewriting closed plans to suit a later convention destroys the record this protects. `PLAN_ACCEPTANCE_EXEMPTIONS` is a ratchet shaped after `check-core-no-stdout.ts`: it may only shrink, and a contract test fails when an entry stops being needed (#113).

### Removed

- **The `coverage` field is gone from the evidence pack rather than made writable.** Both writers hardcoded an empty gap list and the parser rejected a non-empty one, so the ticket's promise that an expired reference produces a coverage gap could never fire. A pack is immutable and a reference expires after composition, so the value could not be written back even in principle; `evidence validate` already reports staleness, and that is where a reader can act on it. A field that can never change says nothing (#116).

### Fixed

- **`value == count` was never true on PostgreSQL, so `verify --after-write` could not report `verified` there.** `firstScalar` returned the driver's value as-is and `compare` used `===`, but pg returns `bigint` / `numeric` / `int8` as strings, so `"0" === 0` was permanently false — and a read-back after a write is almost always a count. The asymmetry is what made it hard to see: `>` and `<` went through JS coercion and passed, so on the same column `value > 5` worked while `value == 6` did not, with the output cheerfully printing `expected: "value == 6"`, `actual: "6"`, `pass: false`. Found by dogfooding a real backfill on PostgreSQL 16, where six rows were correctly updated and the assertion still said no (#115).

- **Blacklist matching in evidence content is bounded to whole identifiers, and its refusal says where.** Blocked terms were compared with `includes()` — no boundary, no minimum length — so a protected column named `id` refused any claim containing "identifier", "considered" or "valid", and the message was one line reading `evidence content contains a blocked identifier`, naming neither the field nor what it hit. A term now matches only when neither neighbour is a letter, digit or underscore, so `id` still hits `orders.id` and a bare `id` but not `identifier`, and regex metacharacters in a term are escaped, so `a.c` no longer matches `abc`. The keys of `blacklist.columns` — table names — were never collected into the term list at all, a silent hole in the other direction, and are now included. The error names the offending field (`subject.kind`, `claim 2 text`) and still does not name the term, since printing a protected identifier into a message the author may paste elsewhere is the thing the blacklist exists to prevent; claims are located by ordinal because the id may itself be the blocked string. Two limits are documented rather than papered over: `secret_customer` written as "secret customer" still gets through, which identifier matching against free prose cannot honestly promise to catch, and reference fields (audit `command`, receipt `path`) are not checked at all yet (#117).

- **The Elasticsearch integration suite had never asserted anything, on any machine.** It reported "container not running on port 9201" against a healthy container answering `200`: Elasticsearch's `GET /` carries no CORS headers, happy-dom's `fetch` drops a header-less response under the same-origin policy, `beforeAll` swallowed the error and every test returned early. It is the only adapter over HTTP, so it was the only casualty. Removing the global preload was tried and reverted — `tests/integration/ui-render-smoke.test.tsx` depends on it, and a per-file import leaks across the files Bun runs in one process, making the outcome depend on file order. `setup-happy-dom.ts` now saves the runtime `fetch` before `GlobalRegistrator.register()` and restores it after, exporting `runtimeFetch` so a test can pin the contract. Only `fetch` is restored: happy-dom's `window` / `document` / `Element` have no runtime counterpart to shadow, and no adapter touches `Request` or `XMLHttpRequest` (#109, #110).

- **A negative test asserting that extra fields are rejected no longer breaks `typecheck:tests`.** The object deliberately carrying a field the validator must refuse was written against a type that does not admit it, which `bun test` never sees and CI's `tsc` step fails on across all ten matrix jobs (#118).

### Documentation

- **ADR 0005's `deferred` described the feature, not the decision.** Of ten ADRs it was the only one not `accepted`, so every inventory picked it back up as an open question — while its content is a settled fail-closed policy with a reopen checklist and a falsification condition already attached. What is deferred is SQD-05 / SQD-06. It is now `accepted`, with a paragraph separating "the policy is settled" from "provider generation is authorized", the latter having not happened — without it, a reader seeing `remain deferred` in the title over an `accepted` status would plausibly "fix" the status (#111).

- **The 2026-08-08 evidence backlog now matches what shipped.** Eight tickets read `Status: Proposed` under a spec header saying no implementation was authorized, a week after all of it went out in v1.53.0. Checking all thirty acceptance criteria against the test files found eleven genuinely asserted, eighteen unproven — mostly asserted halfway — and one structurally impossible. Tickets are marked Delivered with their known deviations and unverified criteria listed per line, and `CONTEXT.md` gains `Known deviation` (deliberately unmet) and `Unverified` (nobody proved it) as distinct terms, because merging them dilutes the first into "everything imperfect" (#112).

## [2.1.0] - 2026-08-16 - The gate asked the wrong question, and one route never reached it

2.0.0 put a two-tier gate in front of raw SQL. This release is what measuring that gate against real servers found: one entire route into the database bypassed it, its qualification criterion asked whether a `WHERE` existed rather than whether it narrowed anything, and its notion of "what kind of statement is this" was the leading keyword — so a full-table delete wearing an `INSERT` or `WITH` in front of it was treated as routine. Each of the three is a way a statement that empties a table reached the database unattended, and each is closed here. The measurement the gate's own ADR bets on is now a command rather than a `jq` invocation somebody has to remember.

### Changed

- **The gate's qualification criterion now requires positive evidence that the `WHERE` narrows the table being written.** It was `statement.where != null`, which asks whether a `WHERE` exists; the question that matters is whether this `WHERE` restricts the target. `UPDATE p SET c = (SELECT … WHERE …)` has one and rewrites every row. A `WHERE` must now reference a column of the table being written — a correlated reference back to the target counts, unless the name is bound by the subquery itself, since `DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM sessions WHERE …)` speaks about the subquery's own rows and was measured emptying the table. This is a lower bound, not a proof: `WHERE id IS NOT NULL` names the target and touches every row. `WHERE 1=1` remains the supported escape hatch (#80, #93).

- **A multi-table write is tier two regardless of its `WHERE`, under the new reason `multi_table`.** `DELETE p FROM p JOIN o ON p.id = o.ref WHERE o.x > 0` deleted 2 of 5 rows on one dataset and all 2000 on another — the same statement, a different answer, so scope is not decidable from the text. A join's `ON` always mentions the target table, so treating it as evidence would readmit the entire class 2.0.0 exists to stop, `UPDATE p SET … FROM o WHERE p.id = o.ref` included. Four criteria were tried and each was broken by the next ordinary statement, so the tier is now decided by what the statement *is* — which is known — rather than by what it will touch, which is not. The remedy in the refusal says "rewrite as a single-table statement or have somebody confirm it", not "add a `WHERE`" (#80).

- **When the parser cannot read a statement, tier one is now an allowlist rather than a denylist.** Enumerating the keywords that introduce a second table lost one round of adversarial review each: `USING`, `JOIN`, CTEs, subqueries, `TABLE` as a subquery. A statement now has to read as "writes one named table, has a `WHERE` or `LIMIT`" and contain no `SELECT` / `TABLE` / `VALUES` / `JOIN` / `USING`, no statement-level `WITH`, and no `UPDATE … FROM` to qualify. Keywords inside parentheses are not statement-level, so `SUBSTRING(x FROM 2)` and `AGAINST ('a' WITH QUERY EXPANSION)` are not misread (#80).

- **Statement type is decided by shape, not by the leading keyword, so a write hidden in front of one no longer buys tier-one treatment.** Measured on PostgreSQL 16 against a 2000-row table: `WITH moved AS (DELETE FROM p RETURNING *) INSERT INTO archive …` deleted 2000 rows and `MERGE INTO p … WHEN MATCHED THEN DELETE` deleted 2000 — both tier one, both skipped by `--yes`. The same CTE under a `CREATE TABLE … AS` head and `MERGE … WHEN MATCHED THEN UPDATE` behave the same way. The criterion is now a nested write anywhere inside parentheses, which holds because a parenthesised expression that is not the statement body cannot contain a write: `INSERT` / `UPDATE` / `DELETE` are reserved words in both dialects, so a column named that way must be quoted, and quoting is stripped before the read. `MERGE` is the exception, so only `MERGE INTO` is matched. Locking clauses (`SELECT … FOR UPDATE`) and foreign-key referential actions (`ON DELETE` / `ON UPDATE`) are stripped first — the latter after a review round found `ON DELETE CASCADE` blocking every table creation with a foreign key, while the same constraint added via `ALTER TABLE` was allowed, one meaning with two answers. A `MERGE` is classified by its `WHEN … THEN` actions: `THEN DELETE` / `THEN UPDATE` are tier-two `multi_table` because `MERGE` reads its rows from `USING`, while a pure-insert or `DO NOTHING` merge stays tier one, which is what keeps ordinary upserts working (#94, #95).

- **Every gate decision is audited as `db-write`, so filtering the audit log by tier no longer misses two thirds of them.** `side_effect_tier` was read from the command's capability table, so the same `DROP TABLE users` decision was recorded `readonly` when it arrived through `query`, `db-write` through `delete`, and `interactive` through `shell` — and tier is the first filter any audit consumer reaches for. `AuditOutcome` gained `sideEffectTier` so a caller that knows more than the capability table can state what the statement actually does; the type deliberately accepts only `db-write` / `local-write`, because this opening exists to be more accurate, not to downgrade a write. `--dry-run` / `--plan` still win, being an explicit execution mode rather than an outcome. The capability table is unchanged — `interactive` remains a correct description of the `shell` command itself (#83).

#### Automation affected

Three shapes that ran unattended before now exit `1`, all of them full-table writes that 2.0.0 intended to stop and mis-tiered:

| Invocation | Now | Remedy |
| :--- | :--- | :--- |
| `UPDATE p SET c = (SELECT … WHERE …)` — `WHERE` only inside a subquery | `reason=no_where` | add a `WHERE` on the target table, or `WHERE 1=1` |
| `DELETE p FROM p JOIN o …` / `UPDATE p SET … FROM o …` | `reason=multi_table` | rewrite as a single-table statement, or run it where a person can confirm |
| data-modifying CTEs and `MERGE … THEN DELETE/UPDATE` | `reason=multi_table` | as above; pure-insert `MERGE` upserts are unaffected |

### Added

- **`dbcli shell` now applies the tier-two gate, the last SQL route that bypassed it.** The REPL called the adapter directly with only permission and blacklist checks in the way, so `DELETE FROM users` demanded a typed table name under `dbcli query` and asked nothing at all one prompt over — protection that depended on which entrance the user picked, which is the thing #70 set out to remove. Only tier two is wired in: every line in a shell is hand-typed, so a per-statement `y/N` would become reflex, and tier one exists for batches of routine writes. A refusal prints to stderr and returns to the prompt with the session, connection and buffer intact; piped input (`dbcli shell < script.sql`) has nobody to answer, so that statement is refused and the rest of the file runs. Every tier-two evaluation is audited. Core still writes to neither stdout nor stderr (ADR 0009): `ReplEngine` takes a `ReplWriteGate` callback and `src/commands/shell.ts` supplies it, asking through the REPL's own readline interface — inquirer opens a second reader and was measured consuming each keypress twice. Line handling is queued, because readline emits every line of a paste before the first `await` returns (#78).

- **`dbcli audit write-gate` turns the measurement ADR 0010 bets on into one command.** The ADR does not justify tier two by argument; it bets that in six months the records will say whether it stopped anything. The data was being written all along (`write_gate_tier` / `write_gate_outcome` / `write_gate_reason`) but reading it meant hand-writing `jq` over `.dbcli/audit/*.jsonl` — a measurement nobody performs is a falsification condition that never fires. The summary answers three questions: how often tier two was reached, grouped by reason; how many were allowed, cancelled and refused; and over what span those numbers were measured. Zero is reported as a conclusion rather than an empty table — it is evidence the criterion is wrong, not that the gate was unnecessary — while an empty audit log is stated as yielding no conclusion at all. Reasons that never fired stay on the table showing `0`, since an omitted row can answer "how often" but not "at all". Tier one is counted separately with its outcome distribution rather than a hardcoded label. Counting is a pure core function; reading files and formatting stay in the command layer. A compile-time guard in `src/commands/audit.ts` fails in both directions if the reason or outcome list drifts from the gate's own (#79).

- **`\` calls a subcommand from inside `dbcli shell`, and SQL keywords win the name collision.** Typing `delete users --where status=active` was classified as SQL on its leading keyword, and with no semicolon it entered multiline mode silently — every subsequent line, `.quit` included, was swallowed into the buffer, leaving a shell that could only be killed from outside. A shell is for typing SQL, so `DELETE FROM users WHERE …` must stay typeable; subcommands moved to their own namespace instead. `\` is separate from the existing meta `.` — the latter is implemented by the shell, the former runs a dbcli subcommand in its own process — and it works for every subcommand, so what has to be remembered is a rule rather than a list of the four that actually collide (`insert`, `update`, `delete`, `explain`). The prefix is checked before the SQL rule, so a trailing `;` typed out of muscle memory does not turn it back into SQL. When a line is classified as SQL but starts with a subcommand name and carries a double-dash option, one line says which prefix would have reached the subcommand — unless the second word is a keyword like `FROM` / `SET` / `INTO`, since `--` also opens a SQL comment (#88).

### Fixed

- **Multiline mode no longer hijacks the shell, and Ctrl-C now cancels what it says it cancels.** While a statement is buffering, the shell's own meta commands are handled instead of being appended, and `.quit` / `.clear` also discard the buffer — but not inside an unterminated string literal, where the line is text rather than a command and lifting it out would split the statement; `MultilineBuffer` is the only place that knows the quoting state, so it answers `isInsideLiteral()`. Separately, pressing Ctrl-C at the gate's "type the table name" question invoked the SIGINT listener while readline's `question` stayed mounted, so the next line typed was consumed as the answer. Each question now gets an `AbortController`; SIGINT aborts it and resolves `null`, which prints "cancelled" rather than "input did not match X" — the latter describes an answer that was never given. The audit still records `declined`, because a decision was made. And cancelling a multiline statement only ever printed a message: `MultilineBuffer.reset()` existed with no caller in the repository, so the next statement was appended to the abandoned half and came back as a syntax error pointing at a keyword the user never typed (#85, #88).

- **A subcommand refused inside `dbcli shell` said something untrue, and before that it could not run at all.** `Bun.spawn` gives a child no stdin by default, so every subcommand was judged unattended: tier two was refused with "nobody can confirm this right now, run it in an interactive terminal", said to a person sitting at one. The child now carries `DBCLI_SHELL_SUBCOMMAND=1` and the refusal states the actual situation and offers a route that works — type the statement at the `dbcli>` prompt, where dbcli will ask for the table name. `code` and `reason` are untouched, since agents branch on those; only the prose for humans changed. Verifying it surfaced two defects further upstream that made the situation unreachable: `--config` was placed after the subcommand, but it is a program-level option that `query` / `insert` / `update` / `delete` do not declare, so every write subcommand ended in `unknown option`; and the tokenizer left matched quotes inside tokens, which go straight into `Bun.spawn`'s argv with no shell to strip them, so `query "DELETE FROM users"` arrived as one quoted identifier (#84).

- **`dbcli q` now enforces permission itself instead of relying on another module to do it.** `q.ts` never called `enforcePermission` and the adapter does not check either; nothing broke today only because `saved-queries/parser.ts` rejects snippets at load time that are not `SELECT` / `WITH`, contain write keywords, or hold multiple statements. A property held jointly by two modules, one of which does not know it is holding it, comes apart the first time somebody reasonably asks for snippets that write. This is defence in depth rather than a bug fix — under the current contract every executable snippet still passes. The check reads `prepared.rewrittenSql` rather than the driver SQL, which is a size-guard wrapper and would describe dbcli's wrapping instead of the requested statement, and it runs before the `--dry-run` branch, so a refusal is not worded differently for a statement that was not going to execute anyway. `checkTablesBlacklist` now receives the real statement type instead of a hardcoded `'SELECT'` (#81).

- **518 test files had never been type-checked, and now 519 are.** `tsconfig.json` matched them with `"tests/**/*.{ts,tsx}"`, and TypeScript's include globs support `*`, `?` and `**/` but do not expand braces — `tsc --listFiles | grep -c "/tests/"` returned `0`. Every type-level assertion written in a test file was decoration: a compile-time guard was found still passing after a union member was removed from under it. The pattern was replaced with `tsconfig.tests.json` and `typecheck:tests`, initially covering only the directories that were clean and ratcheting outward over five batches (339 errors across 174 files, now zero), and `typecheck:tests` is in CI and the release checklist. Roughly six in ten were unchecked indexed access, but the pass also found tests that were wrong: an import from a module that does not exist (Bun strips type-only imports without resolving them), `buildSchemaContext()` called with no argument, a `makeEntry` helper whose `...overrides` silently overwrote the two fields written above it, spies typed as bare `ReturnType<typeof spyOn>` and thereby erasing 13 parameters into `any`, mock adapters missing four methods `QueryableAdapter` requires, and `permission: 'read-only'` — not one of the four legal values — standing in for "insufficient permission" and reaching the right verdict for the wrong reason. `tests/helpers/test-config.ts` was producing a value that was not a valid `DbcliConfig` at all, its `Partial` overrides spread after the required fields turning them all optional (#93, #97).

- **The `inspect` leak check no longer fails at random.** It asserted `expect(stdout).not.toContain('5432')` over the whole serialized output; `--no-connect` emits no port field, but an audit entry's UUID ended in `5432` and reddened CI once. Three UUIDs of 32 hex characters each puts this at roughly one run in 700 — rare enough not to look like a real problem, frequent enough to burn a CI run and an investigation now and then. The check now walks the parsed structure: a value must *be* the port, a string must *contain* the host, and credential field names count wherever they appear (the fixture password is the single character `p`, so value matching cannot help there). The connection object's key set is pinned to `name` / `database` / `version`, which is stricter than before — any added field fails — where the old check exploded on the substring "host" appearing anywhere (#92).

## [2.0.0] - 2026-08-14 - A write nobody can confirm does not run

### Changed

- **BREAKING: a statement that is not limited to particular rows is refused when nobody is watching.** `dbcli query "UPDATE users SET banned = 1"` used to execute against any read-write connection without asking anything, and the caller most likely to produce an unqualified `UPDATE` is the agent this product exists to serve. Raw SQL now passes through a two-tier gate before the connection is opened. Tier one is any write — an `INSERT`, an `UPDATE` or `DELETE` that has a `WHERE` or `LIMIT`, a `CREATE`, an `ALTER` — and behaves as it always has for a non-interactive caller; at a terminal it shows what dbcli understood the statement to do and asks, which `--yes` skips. Tier two is `UPDATE` / `DELETE` with no `WHERE`, `DROP`, `TRUNCATE`, several statements in one string — one statement to a classifier reading the leading keyword, two to a driver — and any statement the SQL parser cannot read: at a terminal the operator types the target table name, and **no flag skips it** — not `--yes`, not `--force`. Away from a terminal, or under `--format json`, tier two is refused: exit `1`, a `reason=` a caller can branch on (`no_where`, `ddl_destruction`, `unparseable`, `multiple_statements`), and the statement never sent, because the gate runs before the adapter is built rather than after. A parse failure resolves to tier two rather than tier one; the cost of being wrong is a needlessly typed table name against a needlessly emptied table. The reasoning, the alternatives, and the condition that would falsify it are in `docs/adr/0010-unattended-callers-are-refused-full-table-writes.md` (#70).

- **BREAKING: `dbcli update` / `dbcli delete` refuse a `--where` that matches on nothing unique.** Their `WHERE` is mandatory, so "no `WHERE`" cannot happen — but `--where "status=active"` reads like a filter and writes like a full-table statement. When the conditions cover neither the primary key nor any unique index, the same tier-two treatment applies: type the table name, or be refused with `reason=non_unique_where`. The schema needed to tell the two apart is already in hand at that point, so this costs no extra round trip. `--force` is unaffected in what it always did — skip the ordinary confirmation — and does not open this gate (#70).

- **BREAKING: `admin` permission no longer means "everything runs".** Permission and the gate are separate axes now: permission says what the connection may do, the gate says whether this statement may run right now. An `admin` connection running `DROP TABLE users` from a script is refused, because `DROP` and `TRUNCATE` have no clause to add and therefore no unattended route at all. Whether they are possible in an environment remains a `permission` decision that lives in version control; whether one happens today is a decision a person makes at a terminal (#70).

- **The permission check for raw SQL now runs before the connection is opened.** It ran inside `QueryExecutor`, after `connect()`, so a refusal cost a round trip and arrived after the gate had already asked its question. The command layer now calls the same `enforcePermission` with the same real statement before either — a connection that may not run this at all is told so rather than asked to confirm something it was never going to be allowed to do. The executor still checks; this only moves the verdict earlier (#70).

### Added

- **`dbcli query --yes`** skips the tier-one confirmation, so a long sequence of routine writes does not become a sequence of keypresses. It has no effect on tier two by design: a flag that could be set once and forgotten is exactly what the escape route for a full-table write must not be (#70).

- **Every tier-two evaluation is written to the audit log — allowed, declined and refused alike** — with `metadata.write_gate_outcome` and `metadata.write_gate_reason`. Deliberately unconditional: a log that kept only the refusals could not tell "nobody writes like that" apart from "everybody found a way around it". In six months, whether this gate prevented anything is a query rather than an impression, and if tier two turns out to be almost never reached, the criterion is wrong rather than the gate unnecessary (#70).

### Migration

Automation that performs unqualified full-table writes stops working. Three shapes are affected, and each has a fixed remedy:

| Invocation | Now | Remedy |
| :--- | :--- | :--- |
| `dbcli query "UPDATE t SET c = v"` | exit 1, `reason=no_where` | `dbcli query "UPDATE t SET c = v WHERE 1=1"`, or add a `LIMIT` |
| `dbcli query "DELETE FROM t"` | exit 1, `reason=no_where` | `dbcli query "DELETE FROM t WHERE 1=1"`, or add a `LIMIT` |
| `dbcli query "DROP TABLE t"` / `TRUNCATE` | exit 1, `reason=ddl_destruction` | run it at a terminal, or apply the schema change through a reviewed migration |
| `dbcli update t --where "status=x" …` | exit 1, `reason=non_unique_where` | select the primary keys first, then one write per key — or run it where a person can confirm |

`WHERE 1=1` is the supported way to say "yes, every row". It is intentionally not a flag: appended to a statement that already has a `WHERE` it is a syntax error, so it cannot be added blanket-style to a script and forgotten. There is no environment variable that restores the old behaviour — a flag that makes the same version behave differently on different machines makes every later bug report ambiguous, and never gets removed.

## [1.58.0] - 2026-08-14 - A write that did not happen stops reporting success

### Changed

- **A `migrate` action somebody declined at the prompt reported `success`, and the prompt itself came from inside core.** `DDLExecutor` called `promptUser.confirm` directly — the one thing ADR 0009 removed from `DataExecutor`, still in place here because the CI gate reads writes and that was an import — and a declined `DROP TABLE` came back as `status: "success"` with the cancellation mentioned only in `warnings`, so a caller reading `status` was told the table was gone. `DDLExecutionOptions` now carries the same `confirm` callback, `src/commands/mutation-confirm.ts` supplies the CLI's implementation on stderr like every other question dbcli asks, and `DDLExecutionResult.status` gained `cancelled`. A destructive operation with no handler and no `--force` is refused rather than defaulted either way, matching `DataExecutor`. With the import gone, `scripts/check-core-no-stdout.ts` now rejects an `@/utils/prompts` import anywhere under `src/core/**` — no module had to join the ratchet for that rule to hold, which is the evidence `ddl-executor` was the last one. ADR 0009 recorded this as an open gap one commit ago and now records it as closed, with the falsification condition naming the new rule (#70).

- **MongoDB and Redis writes now ask before writing, and this breaks unattended scripts that never passed `--force`.** `DataExecutor` performs the confirmation, and only SQL goes through it: `insert`, `update` and `delete` against MongoDB or Redis were issued straight from the command to the adapter, so `dbcli delete orders --where '{}'` emptied a collection without asking anybody, in a terminal or out of it — while the same command against PostgreSQL stopped and waited. All six branches now pass through `confirmDirectMutation` before an adapter is even built, with `--force` honoured in exactly that one place, so the three engines cannot answer the question differently. The prompt shows the statement the dry run would print and omits the parameter block, because a MongoDB or Redis statement carries its values inline. The consequence to plan for: dbcli's existing rule is that a non-interactive run cannot answer the prompt and therefore ends as `status: "cancelled"` having changed nothing, which is what SQL automation has always had to pass `--force` to avoid — MongoDB and Redis automation must now do the same, and a script that does not will stop writing rather than start failing silently. `cancelled` is consequently reachable on every engine, which is what the documentation already implied. `tests/unit/commands/mongo-redis-confirmation.test.ts` covers all six branches against a mock adapter, and `tests/integration/mongo-redis-confirmation.test.ts` re-asserts the important half against the real servers in `docker-compose.test.yml` — the document is still there, the key still holds its value — because "the adapter method was not called" is a statement about a mock, not about the data. That compose file gained a `mongodb` service on the default port, which the pre-existing mongo integration tests were already assuming and silently skipping without, and `bun run test:docker` now runs all of `tests/integration` rather than only `tests/integration/adapters` — it brought up six services and then exercised three of them (#70).

- **`status` on the `insert` / `update` / `delete` result envelope gained `cancelled` and `dry_run`, and this is a breaking change to what those commands report.** Declining at the confirmation prompt, previewing with `--dry-run`, and running a write that matched no rows were all one value: `status: "success"` with `rows_affected: 0`. The three are different events and a caller had no way to tell them apart. Worse, all three commands derived the audit entry's success flag from that field, so pressing `N` at the prompt wrote an audit record saying the write had happened — an audit log that lies is worse than none. A parallel field was rejected: it would have left `status` still saying success while `outcome` said cancelled, and every consumer reading only `status` — `writeAuditEntry` included — would have stayed wrong. Exit codes are unchanged: only `error` exits `1`, because cancelling is a choice rather than a failure. The audit mapping now lives in one place (`src/commands/mutation-audit.ts`) instead of one copy per command; a dry run is recorded as successful because it did complete the preview it was asked for, a cancellation is recorded as unsuccessful, and `metadata.outcome` carries the exact ending in both cases, since a boolean cannot express "did not happen, did not fail". `tests/unit/core/data-executor-outcome-status.test.ts` pins all four endings as mutually distinguishable and asserts that neither cancellation nor dry run issues the statement. The guarantee is that no write is sent, not that the database is untouched: both paths still open a connection and read the table schema, because the SQL a dry run exists to show cannot be built without the column list, and a confirmation prompt has nothing to display until it is. `tests/unit/commands/mutation-db-contact.test.ts` states that boundary at the command level — `execute` never called, `connect` and `getTableSchema` called once each — so the wider claim cannot be assumed from the narrower test (#70).

- **The confirmation prompt for `insert` / `update` / `delete` moved to stderr, so stdout is one JSON document whether or not the write was forced.** The generated SQL, the destructive-delete warning, the parameter list, and the `y/n` question were all written to stdout ahead of the result envelope, which meant that every mutation nobody passed `--force` to produced stdout no parser could read — including with `--format json`, whose entire purpose is to be parsed. The bug survived because the JSON test forced the write and therefore skipped the confirmation altogether. All four now go to stderr, matching what `audit clear` already did for its own confirmation: a question addressed to a person is not part of the result. A terminal shows both streams, so nothing changes for the human being asked, and `tests/unit/commands/mutation-output-characterisation.test.ts` pins the block byte for byte on stderr while asserting `JSON.parse` succeeds on stdout for a non-forced run. `promptUser.confirm` writes to stderr for every caller now, not only these three, since a y/n question on the data channel is never what was wanted. Everything in the block is localised: `Generated SQL:` and `Parameters:` are new `ceremony.*` keys, and the destructive-delete warning and the question itself moved out of `DataExecutor` — `MutationConfirmationRequest` now carries `destructive: boolean` instead of a finished `warning` sentence and `prompt` string. The line is not "core cannot translate" — `permission-guard` now does, and `blacklist-validator` always did — it is that core states facts and the command layer chooses words: whether a delete can be undone is a fact, while the sentence shown about it, in what tone and on which stream, is presentation, and an embedder should be able to say it in its own product's voice. The refusal `enforcePermissionForType` throws is localised in place (`errors.permission_requires_level`), with the permission names interpolated verbatim since they are the values written in the config file. English output is unchanged in every case; `tests/unit/i18n/ceremony-messages.test.ts` checks key and placeholder parity between the two `ceremony.json` files, so an English string added without its translation now fails (#70).

- **`--recovery` now covers failures the executor reports, not only failures it throws, and the recovery envelope replaces the result envelope rather than following it.** A statement that failed inside `DataExecutor` returned a result with `status: "error"`, which the command printed as the JSON result envelope before exiting `1` — `--recovery` was consulted only in the outer catch block, so the flag silently did nothing for the most common kind of write failure. Both failure paths now emit the recovery envelope, and a caller parsing stdout gets exactly one JSON document either way. Automation that parsed the result envelope out of a failed `--recovery` run must read the recovery envelope instead; automation that does not pass `--recovery` is unaffected (#70).

### Added

- **`insert`, `update` and `delete` say what happened in prose when a person is watching.** These commands declared `--format` but never branched on it, so a human running one by hand got a JSON envelope and nothing else. In an interactive terminal they now print the affected row count and table, the elapsed time for work that actually ran, and — for a write that changed rows — the fact that dbcli has no automatic undo for it. Redirected or piped stdout is byte-for-byte the envelope it always was, and `--format json` keeps the envelope in a terminal too; `--format text` is deliberately not treated as a request for prose, since it is the flag's default and therefore appears on invocations that asked for nothing. Ceremony strings live in `resources/lang/{en,zh-TW}/ceremony.json`, following the precedent set by the shell strings rather than being merged into the general message file (#70).

- **A write that fails in a terminal now says so in prose too, on stderr.** Prose covered the endings a person cares least about — a successful write, a cancellation, a dry run — while the two that actually stop you got a raw JSON envelope on stdout: a blacklist refusal and a validation failure (a malformed `--set`, a missing `--where`). Both now go through `printMutationFailure`, which prints the reason as a sentence when somebody is watching and the same envelope, byte for byte, when nobody is. Human-mode failures — including the executor's own `status: "error"` — write to **stderr**, joining the `PermissionError` and `ConnectionError` branches that always did, so every human-facing failure is on the error stream while routine progress stays on stdout. A blacklist refusal gets a hint naming `dbcli blacklist list`; nothing else gets the `--recovery` line, because `--recovery` writes a plan for a statement that failed against the database and a refusal at this stage never reached one (#70).

- **Core modules can no longer write to stdout, and CI fails if one starts.** `DataExecutor` printed the generated SQL and blocked on `promptUser.confirm` from inside `src/core`, on the same stdout that carries the JSON envelope agents parse — and `dist/core.mjs` shipped a real `import("@inquirer/prompts")` so that a library consumer could be handed an interactive prompt it never asked for. Core now describes the pending mutation and asks the caller through a `confirm` callback; `src/commands/mutation-confirm.ts` holds the CLI's implementation. `scripts/check-core-no-stdout.ts` enforces the boundary in CI, with the 16 modules that predate the rule in a ratchet list that can only shrink. The reasoning, its alternatives, and the condition that would falsify it are recorded in `docs/adr/0009-core-does-not-write-to-stdout.md` (#70).

### Fixed

- **Deleting an Elasticsearch index needed `data-admin`, and three schema changes needed nothing but `query-only`.** The classifier matched paths without looking at the method, so one function mis-tiered four different requests. `DELETE /users` removes an entire index and was classified `DELETE` — the delete-a-document tier — which meant `data-admin` could destroy an index while the SQL equivalent, `DROP TABLE`, has always required `admin`; `DELETE /logs-*` and `DELETE /_all` went the same way, at cluster scale. Worse, `DELETE /users/_alias/a` matched the `_alias` **read** rule and `PUT /users/_mapping` and `PUT /users/_settings` matched theirs, so a `query-only` credential could delete an alias and rewrite a mapping. A DELETE is now the `DELETE` tier only when it names a document (`_doc/<id>` or `_source/<id>`) and `DROP` — `admin` — otherwise, and a read rule requires a read method, with `_search` and `_count` also accepting `POST` because that is how a query with a body is sent. Anything whose scope cannot be established fails closed to `admin`: the cost of being wrong that way is a refusal a user can escalate, rather than an index nobody can get back. The adapter's own calls are unaffected — it reads mappings with `GET` and deletes documents through `_doc/<id>` — so this changes only what a raw request through `query` may do. `tests/unit/core/elasticsearch-destructive-scope.test.ts` pins all seventeen cases as a matrix of classification and tier (#70).

- **The last four integration files that never ran anywhere now run everywhere.** `p1-error-classification`, `p2-explain` and `p3-missing-index` were gated on `TEST_MARIADB_HOST` — an operator-supplied MariaDB that `docker-compose.test.yml` did not provide, so 23 assertions about MariaDB error codes, `ANALYZE SELECT`, and EXPLAIN output shape skipped on every machine and every CI run since they were written. The compose file gained a `mariadb:11` service on port 3308 (its own service, not a MySQL alias: the codes and EXPLAIN shape are precisely what those tests distinguish), and the three files now gate on reachability like everything else. `q-live` was gated the same way on `DBCLI_LIVE_PG_HOST`, and wanted nothing more specific than a real PostgreSQL, which the stack already ships. Running it for the first time falsified one of its assertions: it expected `SELECT :v AS x` to return the number `1`, and PostgreSQL types an untyped parameter as text — `EXPLAIN VERBOSE` shows `'1'::text` — so the value is the string `"1"`. The assertion was wrong from the day it was written and no run had ever said so. `tests/integration` now reports 652 passing and **0 skipped** (#70).

- **`q`, `query` and the Elasticsearch path told users to grant a level that would not have helped.** `PermissionError.requiredPermission` is what every command interpolates into `Permission denied (required: …)`, and these three throw sites passed the level the caller already had — so a query-only user running `DELETE` through `q` read `required: query-only` above a sentence saying it needs data-admin. The structured-write path was corrected first (#72) by deriving the level at the throw site, which works only where the type alone decides it; a write hidden inside a read needs admin whatever its leading keyword says, a multi-statement SQL needs admin, and an unrecognised statement needs read-write. The level is now decided by the branch that decides the refusal and carried on `PermissionCheckResult.requiredPermission`, so the header and the reason cannot disagree — `tests/unit/core/permission-refusal-level.test.ts` asserts that granting exactly what a refusal names lets the same statement through, rather than pinning a table of strings. Elasticsearch stopped restating the tier table while it was being fixed: it was a third copy, agreeing with the shared one on every type its classifier produces, and its refusal now names the level instead of saying "requires higher permission tier", which is true of every refusal and tells nobody what to change (`errors.elasticsearch_requires_level`, both languages) (#70).

- **The integration tests never ran in CI, and several of them never ran anywhere.** The matrix job sets `SKIP_INTEGRATION_TESTS=true`, so `tests/integration` was compiled and skipped on every push — 639 assertions against MySQL, PostgreSQL, Redis, MongoDB and Elasticsearch that only ever executed on a developer's machine. A new `integration` job runs them on Linux against `docker-compose.test.yml`. The part that makes it a signal rather than a formality: `REQUIRE_INTEGRATION_SERVICES=true` turns the suite's auto-skip into a failure naming the address, because a job that starts no services otherwise reports exactly the same green as one that starts all of them, and `bun run services:check` fails first with a readable list, reading the ports out of the compose file rather than a copy that would drift. Turning that flag on immediately found the second half of the bug: `verify-migration`, `verify-rollback`, `verify-safe-backfill` and `assert-verification-artifact` dialled `localhost:5432` as `postgres/postgres` — a server this repo has never shipped — while the adapter tests used `PG_PORT` at `5433` as `dbcli/testpass`, the one in the compose file. Two spellings for one address, and the files using the wrong one had been skipping since they were written, locally included. Connection defaults now live once in `tests/integration/helpers.ts`. (#70).

- **`insert` / `update` / `delete` accepted any `--format` value and quietly did something else with it.** The flag is declared as `text or json`, but nothing checked, and `shouldRenderForHuman` only special-cases `json` — so `--format xml` meant "prose in a terminal, envelope in a pipe", which is the default it was trying to override. An unsupported value is now refused before the connection, the schema read, and the audit write, the way `dbcli export` has always validated its own formats, with the offending value named and localised (`errors.invalid_output_format`). `--plan` is covered by the same guard (#70).

- **Four refusals reached a zh-TW user as English, or as English glued to Chinese.** The three sentences `permission-guard` builds for the cases the tier table cannot phrase — a write hidden inside a read, a multi-statement SQL below admin, and an unrecognised statement under query-only — were string literals, and `handleMutationError` prefixed the already-translated `PermissionError` message with a literal `Permission denied: `, producing a half-translated sentence. All four are catalogue keys now (`errors.escalated_write_requires_admin`, `errors.multiple_statements_refused`, `errors.unknown_statement_query_only`, `errors.permission_denied_reason`), with the permission levels and SQL keywords interpolated verbatim because those are values a user types into a config file. The English is character-for-character what it was — several tests assert these sentences and none of them changed — and `tests/unit/i18n/permission-refusal-messages.test.ts` renders each in both languages and checks key and placeholder parity across the two `messages.json` files, so an English string added without its translation fails (#70).

- **An Elasticsearch `insert` / `update` / `delete` answered every user in Traditional Chinese.** The "Elasticsearch does not support this command" sentence was a string literal in the `error` field of the envelope, in three files where everything else goes through `t()`. It is now `{insert,update,delete}.elasticsearch_unsupported` with English and zh-TW values, so the message follows `DBCLI_LANG` like the rest of the CLI. `tests/unit/commands/redis-es-unsupported.test.ts` asserts the English text under the default locale, which is what an English-locale user was never getting (#70).

- **The three write paths' permission checks agreed by luck, and their refusal messages named levels that would not have worked.** `executeInsert` and `executeUpdate` handed the classifier a synthetic statement (`'INSERT INTO dummy'`) while `executeDelete` compared `this.permission` inline — one axis, two implementations, certain to drift. All three now call `enforcePermissionForType`, which skips the classifier because the caller assembled the statement and therefore already knows its type; passing the *real* generated SQL was tried and rejected, since it forces the statement to be built and its columns validated before the caller is known to be authorised, so an unauthorised user would learn `Column not found` first and the schema would leak. Separately, `handleMutationError` discarded the `PermissionError` and substituted a fixed sentence about query-only mode whatever the actual level was, and excluded `delete` outright. Refusals are now derived from the same tier table the decision uses, so they name the lowest level that actually permits the operation alongside the current one — previously a query-only user was told `DELETE` "requires read-write", which read-write does not grant. The header printed above that reason was wrong in the same way and is fixed with it: `PermissionError.requiredPermission` is what every command interpolates into `Permission denied (required: …)`, and the SQL path passed the level the caller already had, so a query-only user read `required: query-only` directly above a sentence saying INSERT requires read-write. It now carries the level that would actually work, which is what the Redis enforcer has always passed and what `delete` used to hardcode. `tests/unit/core/permission-refusal-level.test.ts` asserts the named level really permits the operation rather than pinning a table of strings. `q` and the Elasticsearch enforcer still pass the current level; those refusals cover composite and hidden-write cases where "the level that would work" is not always a single answer, and they are left for a change that can decide it. The verdict matrix itself is unchanged: `tests/unit/core/data-executor-permission-characterisation.test.ts` pinned twelve verdicts before the unification landed, and only four messages moved. `permission-guard.ts` was 1187 lines by the end of this and is now 460: SQL lexical analysis, Redis, and Elasticsearch are three independent classification domains and moved to `src/core/permission/{sql-analysis,redis,elasticsearch}.ts` with no re-export shim — the six importers point at the new paths, and none of the moved symbols was on the published `./core` surface. The three tier branches inside `checkPermissionForClassification` also stopped repeating what `TIER_GRANTS` already says: each tier's permitted set is derived by accumulating the tiers below it, which is the same drift-by-duplication this bullet removed from the refusal messages (#70).

## [1.57.0] - 2026-08-14 - One connection's password, rotated on its own

### Added

- **`dbcli password [connection]` — rotating one connection's password no longer means editing the rest of its config.** A connection whose password is rotated on a schedule previously had two options: re-run `init` and re-enter every other field, or hand-edit the env file and hope the key name matched what the reader looks for. The new command changes the password and nothing else. Where the value lands is read from the config rather than derived from a naming rule: `password: { "$env": "NAME" }` rewrites `NAME` in that connection's `envFile`, and a connection still holding a literal password is converted to `{ "$env": "DBCLI_<CONN>_PASSWORD" }` once, so every later rotation touches only the env file. v1 configs rewrite `DBCLI_PASSWORD` in `.env.local`, matching the v1 reader at `src/core/config.ts:200`; a v1 config whose password comes from any other environment variable is refused with the reason, because v1 has no per-connection env file and no file dbcli could write would make that variable resolve. The new password is verified by connecting with it **before** anything is written — a rejected credential exits 1 with the stored value untouched, rather than leaving a config that no longer opens the database — with `--skip-test` for when the database is unreachable from where the rotation runs. Three input paths, one of which must be chosen: a masked prompt (never a plain-text fallback, since that would print the secret into the scrollback), `--stdin` for rotation scripts, and `--password` for callers that accept shell-history exposure. The env file is written `0600` on POSIX (Windows has no equivalent mode bit, so the file inherits the directory's ACL), the value never reaches stdout, stderr, or the audit log, and `DBCLI_AGENT_MODE=1` refuses at the first line of the action rather than after prompting and connecting.

### Fixed

- **A password written to a connection that declared no `envFile` could not be read back.** `loadConnectionEnv` (`src/core/config-v2.ts:164`) loads only the file a connection names, and the `.env.local` fallback in `src/core/config.ts:274` recognizes exactly one key, v1's `DBCLI_PASSWORD`. So writing `DBCLI_<CONN>_PASSWORD` into `.env.local` for a v2 connection with no `envFile` produced a config whose `$env` reference resolved to nothing: `Environment variable not defined`, on every subsequent command. Rotation now records `envFile` on the connection as part of the write. `tests/unit/core/connection-credential.test.ts` asserts the round trip through `configModule.read()` for all four paths (v2 with and without `envFile`, v2 converted from a literal, v1) rather than asserting the file merely contains the expected line — the file being right while the reader cannot see it is precisely the failure that shipped otherwise.

- **A password containing `$&`, `$1`, or `` $` `` was silently stored as something else.** The in-place rewrite passed the new line as `String.replace`'s second argument, where `$`-patterns are substitution syntax: rotating to `a$&b` over an existing `K=old` wrote `K=aK=oldb`. Verification passed because it used the in-memory value, so the command reported success and the next connection attempt failed with a password nobody could reproduce. The replacement is a function now, which does no `$` expansion. Values are also written quoted (`NAME="…"`), because both env parsers trim the whole line before splitting — an unquoted value silently lost leading and trailing whitespace. `parseEnvPassword` strips one layer of matching quotes to match `parseEnvContent`, so values written by either path read back identically.

### Removed

- **`writeConnectionSecret` — the exported helper wrote to a file the reader never opens.** Exported from `@carllee1983/dbcli/core`, it derived the env var name from the connection name and defaulted the file to `.env.<connection>` when a connection declared no `envFile`, while the reader falls back to `.env.local` and, for connections created with `init --use-env-refs --env-password <VAR>`, looks up `<VAR>` rather than the derived name. Both mismatches ended the same way: a write that succeeded and a password that could not be read. `setConnectionPassword` and `resolvePasswordTarget` replace it on the same barrel — they resolve the target from the config, convert a literal password once, and record `envFile` when it is missing. Callers of the old function should switch to `setConnectionPassword(projectPath, connectionName, value)`; the `field` parameter is gone, since `'password'` was its only accepted value.

## [1.56.0] - 2026-08-13 - The package no longer runs the CLI when you import it

### Removed

- **`exports["."]` — importing the package ran the CLI instead of returning a module.** The root export pointed at `dist/cli.mjs`, and `src/cli-runtime.ts:280-290` calls `outputHelp()` and `parseAsync(process.argv)` at module top level with no guard. So any import that reached the runtime executed the CLI against the host process's argv: under Bun, `await import('@carllee1983/dbcli')` printed 186 lines of help and exited 1 — the statement after the import never ran — and under Node it threw `ERR_MODULE_NOT_FOUND` for the same extensionless `./cli-runtime` specifier described in v1.55.0. `.` is gone; `./core` and `./agent-core`, both with `types`, are the library surface, and neither bundle contains `cli-runtime`. `bin` does not resolve through `exports`, so `dbcli` itself is untouched. Anyone importing the root now gets `ERR_PACKAGE_PATH_NOT_EXPORTED` instead of a process that exits — a declaration withdrawn, not a capability. `tests/integration/runtime-contract.test.ts` asserts no `exports` target is the `bin` target, and keeps a positive control on the top-level side effect, so if `cli-runtime` ever stops executing on import the test says so rather than leaving the export permanently unreconsidered (#67).

## [1.55.1] - 2026-08-13 - The Bun-missing warning actually reaches the user

### Fixed

- **v1.55.0's post-install check could never fail, and npm therefore never showed it.** Verified against the published package in `docker run --rm node:22`: `npm install -g @carllee1983/dbcli` printed `added 131 packages` and nothing else, and `dbcli --version` then died with `/usr/bin/env: 'bun': No such file or directory` — exactly the experience the check was added to prevent. Two causes stacked. npm hides lifecycle-script output unless the script exits non-zero (the message was there all along under `--foreground-scripts`), and the `postinstall` command ended in `|| exit 0`, which swallowed any exit code the check could produce. The trailing `|| exit 0` is gone, and `scripts/postinstall-check-bun.mjs` now exits 1 when Bun is missing **and** `npm_config_global` is `true`. A global install is the case whose entire point is a runnable `dbcli`, so it fails loudly with the reason, and npm rolls the `bin` back rather than leaving a dead executable on `PATH` (verified: `command -v dbcli` finds nothing afterwards). A dependency install is left alone — that is the `./agent-core` consumer, who needs no Bun, and it still exits 0 with the subpath export importable from Node. `tests/integration/runtime-contract.test.ts` pins both outcomes and asserts the published `postinstall` command contains no `exit 0` mask, since a check that cannot fail is indistinguishable from one that passes (#65).

## [1.55.0] - 2026-08-13 - Packaging: the declared runtime matches the artifact

### Removed

- **`engines.node` — the runtime declaration now matches the artifact.** `package.json` claimed `node: ">=18.0.0"` since the first release, but measured on Node v22.17.1 against the `v1.54.1` `dist/`, only one published entry point actually loaded. `node dist/cli.mjs` threw `ERR_MODULE_NOT_FOUND` as soon as the launcher reached its dynamic import: `src/cli.ts` keeps the runtime path as a non-literal `'./cli-runtime'` so the `--version` launcher does not inline the heavy runtime, and Bun's resolver appends `.mjs` where Node's ESM resolver requires the extension. `import('dist/core.mjs')` — the `./core` subpath export — threw `Bun is not defined`, the bundle holding 30 Bun global references against `dist/cli-runtime.mjs`'s 143. The `bin` shebang is `#!/usr/bin/env bun` regardless, and the `--version` fast path branches on `import.meta.main`, which is `undefined` before Node 24. `engines` now declares `bun >= 1.3.3` alone. `dist/agent-core.mjs` was and remains Node-importable, and is documented as the one entry point that is. npm and npx stay supported as distribution channels, with the docs stating plainly that the installed executable still runs under Bun. `tests/integration/runtime-contract.test.ts` holds both ends: re-declaring `engines.node` fails unless `dist/cli.mjs` and `dist/core.mjs` really import in a bare Node process, and `dist/agent-core.mjs` must keep importing there whatever else changes. The alternative — `--target node` plus ~169 Bun API replacements in `src/` and a Node runtime CI suite — is rejected and its cost recorded in `docs/adr/0008-dbcli-is-a-bun-program-and-engines-says-so.md` (#65).

### Added

- **An install on a machine without Bun now says so.** npm validates no `engines` field it does not recognize, so dropping the false `engines.node` would otherwise have left `npm install -g` with no signal at all — success, then a `dbcli` on `PATH` that dies on its shebang. `scripts/postinstall-check-bun.mjs` prints the reason and the Bun install command at that moment, and never fails the install. It runs as `bun … || node … || exit 0` because the primary install path is Bun-only machines, which have no `node` to invoke a postinstall with. `plugins/dbcli-agent/scripts/install-dbcli.sh` stopped falling back to npm when Bun is absent: it used to leave a non-functional `dbcli` behind, and now refuses before changing anything (#65).

## [1.54.1] - 2026-08-13 - Error classification: a failure now says which layer broke

### Fixed

- **A dropped connection, an exhausted connection pool, an unreachable host, and a TLS failure each say so.** `TRANSPORT_CODES` listed seven keys, so `ECONNRESET`, `EPIPE`, `EHOSTUNREACH`, `ENETUNREACH`, TLS certificate codes, PostgreSQL SQLSTATE class `08` and `53300`, and MySQL `1040` all carried a code, skipped the message-pattern fallback (which only runs when there is none), and landed on `Database error (ECONNRESET): …` with hints about `dbcli schema`. They now map to four new categories — `CONNECTION_LOST`, `TOO_MANY_CONNECTIONS`, `EHOSTUNREACH`, `TLS_ERROR` — each with the remedy that actually applies: retry a transient drop, inspect `pg_stat_activity` / `Threads_connected` against `max_connections`, check routing and VPN rather than DNS, or point `caPath` / `rejectUnauthorized` at the right certificate. PostgreSQL class `57` (`57P01` / `57P02` / `57P03`) and MySQL `1053` / `2006` / `2013` join them: restarting the server under a running query was reported as `Database error (57P01)` with hints about confirming the statement's objects. The codeless wordings drivers use for the same event — `Connection terminated unexpectedly`, `server closed the connection`, `server has gone away` — are recognized too. `57P03` (still starting up) and `08004` (the server answered and refused) get their own categories rather than borrowing a message that says the opposite, and TLS is matched by code prefix because enumerating OpenSSL's verify codes would keep missing some. The envelope states each cause in its own words instead of inheriting the shared recovery code's description — `CONN_HOST_NOT_FOUND` says the name could not be resolved, which is the one thing `EHOSTUNREACH` rules out — and TLS failures no longer route to the credentials plan, whose second step re-runs `init` for a certificate it never asks about. The adapter-code-to-envelope-code and the connection-versus-statement tables are both exhaustive `Record`s over the code union now, so a future code cannot silently inherit a generic category, and the REPL's reconnect decision reads the same table instead of its own list of codes and message substrings (#62).

- **`insert` / `update` / `delete` / `q` no longer report every failure as "failed to connect".** All four branched on `instanceof ConnectionError` and applied one message key, but that class carries every adapter-level error and only four of its nine codes are transport failures — so a missing table, a syntax error, or a statement timeout all arrived as `Failed to connect to database: …` while the connection was fine. The wording is now chosen by code, and rendering goes through the same `formatCliError` the central presenter uses, so these commands print the stable `Code:` line and the error's hints — both previously dropped on this path — exactly as `query` does (#61).

- **A statement the server canceled is no longer reported as a connection failure.** PostgreSQL `57014`, MySQL `3024`, and MariaDB `1969` fell through to `UNKNOWN` / `CONN_UNKNOWN`, so the CLI answered a query that ran out of statement time with connection-troubleshooting hints and a recovery plan that opened with `dbcli doctor` — the one thing that was not broken. They now map to a `STATEMENT_TIMEOUT` adapter code whose hints point at the query (`dbcli lint`, `dbcli explain`, re-run with an explicit `--statement-timeout <ms>`). The `--recovery` envelope keeps `schemaVersion` 1 and reports `CONN_TIMEOUT` with `details.connectionCode: "STATEMENT_TIMEOUT"`; that field selects the query-oriented plan, replaces the network-flavored message with one that states the ceiling that was in force, and suppresses both the `doctor-*` branches — whose `branchFork.after: 1` assumed step 1 was `doctor` — and the `verify` step, since nothing verifies this error except re-running the statement, which only the caller has. PostgreSQL `57014` is `query_canceled`, not only `statement_timeout`, so a `pg_cancel_backend()` or recovery-conflict cancel keeps the verbatim `Database error (57014): …` form rather than asserting a ceiling nobody set.

## [1.54.0] - 2026-08-13 - Query engine hardening: timeout semantics, load-on-demand, deterministic builds

### Added

- **Separate connection and statement timeouts.** `--timeout` previously did two jobs at once: PostgreSQL fed it to both `connectionTimeoutMillis` and `statement_timeout`, so the 5000ms connection default silently became a global query ceiling, while MySQL consumed neither and ignored `--timeout` entirely. Connection timeout keeps its 5000ms built-in default, statement timeout now has none (the server decides) unless you ask for one, and the new root-level `--statement-timeout <ms>` plus the `statementTimeout` connection field (0–3600000, `0` removes the ceiling) adjust it on its own. MySQL now consumes both, mapping the statement limit onto session-level `max_execution_time` / `max_statement_time` where the server supports it.

### Changed

- **The CLI loads what a command actually needs.** Subcommands register lazily, SQL drivers load at connection time rather than at import, and `node-sql-parser` is both deferred and externalized from the bundle — measured at roughly 8ms off startup for the lazy registration alone.
- **Full-schema scans cost less.** Per-table queries are merged, row estimates replace `COUNT(*)`, and remaining work runs with bounded parallelism. The query path no longer loads the layered schema in full — it fetches the single table it needs.
- **Repeated lookups are cached within a process.** Config binding files are read and validated once per process, and the skill update check keeps a TTL cache instead of re-checking on every invocation. Redis and Elasticsearch list operations were narrowed to what the caller asked for.
- **Identifier quoting and error classification each have one implementation.** Quote/encode helpers were consolidated into a shared utility, and driver errors are now classified by error code first rather than by matching message text.
- **Server-side script protection lives in the adapter layer**, so every caller is covered by the same guard rather than each command re-implementing it.

### Fixed

- **`bun run build` was non-deterministic.** Consecutive builds of identical sources alternated between two `dist/cli-runtime.mjs` outputs about 690KB apart, depending on whether the bundler pulled in 48 `@inquirer/*` modules. `@inquirer/prompts` is now external, which also removes a silent degradation path where the prompt implementation quietly changed between builds. `bun run build:determinism` checks this in CI.
- **One CLI query writes exactly one audit entry.** Some paths recorded the same query more than once.
- **Windows CI is green again.** Path separator assumptions, CRLF handling in test fixtures, and CRLF frontmatter stripping in skill sources were all Unix-only.
- **The startup benchmark measures the noise floor rather than the median**, which is what actually distinguishes a regression from scheduler jitter, and a guide test no longer flakes on a random UUID colliding with `'5432'`.

## [1.53.0] - 2026-08-09 - Offline evidence, semantic contracts, and impact assessment

### Added

- **Offline evidence packs.** `dbcli evidence compose`, `validate`, and `render` create, verify, and render workspace-contained evidence packs from safe claim text plus existing verification artifacts, audit entries, and optional assert receipts. Packs omit SQL, rows, targets, credentials, audit metadata, and verification summaries; source retention loss remains visible without preventing historical rendering.
- **Evidence receipts for post-write assertions.** `assert --evidence-receipt <path>` atomically records safe provenance only after the verdict, audit attempt, and optional verification artifact are authoritative. Receipts are workspace-contained, contain no SQL or returned data, cannot be used as execution approval, and may be composed into an evidence pack.
- **Reviewable semantic contracts.** `dbcli contract validate|context|search|drift` governs optional `dbcli.contracts.json` evidence expectations for canonical semantic terms. The commands are offline and read-only; only valid approved contracts enter ordinary agent context.
- **Offline impact assessment.** `dbcli impact assess` creates a declared-coverage report for a design change against exactly one local schema-cache or ORM baseline, optionally incorporating reviewed data-access metadata and redaction-first proxy workload evidence. It never connects, executes SQL, or claims complete coverage.

### Changed

- **Shared execution and adapter boundaries.** Query execution now uses an injectable command runtime, SQL adapters share readiness and driver-error handling, and doctor accepts a non-SQL collector runtime. These internal changes keep the CLI behavior stable while making offline evidence and impact workflows testable.
- **Documentation and agent skills cover the new surfaces.** English and Traditional Chinese Markdown and HTML guides, installed skill copies, and reference material document evidence packs, assert receipts, semantic contracts, and impact assessment.

### Fixed

- **Release audit no longer resolves a vulnerable `nanoid`.** The build-only PostCSS and Tailwind dependencies now resolve `nanoid@3.3.18`, satisfying the security advisory without adding a runtime dependency.

## [1.52.1] - 2026-08-08 - Skill audit: correct claims, per-platform install, drift gate

### Fixed

- **The skill documented three flags that do not exist.** `q --use` (the global `dbcli --use <name> q` form is the real one), `q --collection` (a MongoDB snippet's `target:` is the only collection source), and `audit tail --recovery-ref` (it lives on `audit show`). The same wrong `audit tail --recovery-ref` is corrected in `docs/user` (en/zh, Markdown and HTML).
- **The `design` artifact example failed its own validator.** It is replaced with one that validates clean, and the naming rules it has to satisfy are now documented: lowercase kebab-case for design names versus SQL identifiers for tables and columns, endpoints referencing a model rather than a table, strict objects, descriptions that must not contain SQL keywords, and the size limits. Structural violations report `INVALID_ARTIFACT`, a code the severity table did not list.
- **Stale lists corrected against the CLI.** `--recovery` covers `lint` and `diff`; verification subject kinds include `table` (what `verify constraint` writes); the Redis permission table includes `XLEN` / `XREAD` / `XRANGE` / `XREVRANGE` / `XADD` / `XDEL` / `LREM`; `audit show` lists `--brief` and `--for-agent`; the snippet guard emits `LIMIT 1001`, fetching one extra row to detect truncation. Elasticsearch supports `q`, and the 10 000 bound belongs to `query` — `export --no-limit` streams via the scroll API. `schema --help` claimed `--sample-size` defaults to 50; it is 100.
- **`design` was unreachable from the skill entry point.** `SKILL.md` did not mention it at all, so an agent asked to design or review a schema would hand-write DDL and bypass the review-only `propose` contract. It now has a command row, both workflows, and a guardrail that a proposed plan is never executed.
- **Six drifts between the English and Traditional Chinese skills.** The most serious dropped the permission-tier semantics (multi-statement SQL rejected below `admin`, snippets free of write and DDL keywords, `$out` / `$merge` requiring `data-admin`). The MongoDB connection guidance also disagreed between languages — field-by-field is the recommendation, full URI the escape hatch — and the zh-TW side was missing the env-refs MongoDB exception, the `uri`-wins-silently gotcha, `--slow-ms` on `query` and `q`, and the `proxy analyze` action guidance.
- **Cursor and Windsurf installs were the Claude skill verbatim.** Windsurf does not parse frontmatter, so roughly 900 characters of `description:` were read as rule text; Cursor reads `description` / `globs` / `alwaysApply` and received none of them. Both platforms keep `reference.md` outside the primary file's directory, so every mention of it resolved to nothing. `dbcli skill --install` now shapes the file per platform — Cursor as an Agent Requested rule, Windsurf with the frontmatter stripped and the description kept as prose — and repoints the reference path. Recognizing an existing dbcli install no longer depends on the frontmatter, so a Windsurf reinstall stops backing up dbcli's own file. See ADR 0006.

### Added

- **`reference.md` has an index.** 3300 lines previously offered no way in but a full read or a guessed grep, and the skill pointed at it in prose ("reference.md Redis section"). Those pointers are real anchors now, and a test derives the anchors from the headings so a renamed heading cannot break them silently.

### Changed

- **The bilingual parity gate compares content, not just shape.** It checked heading levels, fence counts, table rows, and a curated token list for mere presence — every drift above kept that structure intact. It now compares per-section counts of every code token and list item; run against 1.52.0 it reports 48 problems it used to pass. Its success message no longer reads as "the docs are aligned" when it only checked the skeleton.
- **The skill entry point carries less that an agent cannot act on.** The always-loaded `description` drops from 990 to 626 characters with every trigger branch intact, release markers such as `(v1.23)` and an internal ticket id are gone (an agent has exactly one installed version), and the `proxy` row's flag wall becomes an anchor.

## [1.52.0] - 2026-08-07 - Offline database design assistant and slow-query hints

### Added

- **Offline database design assistant.** `dbcli design init|validate|render|diff|propose` authors and reviews a version-controlled `dbcli.design.json` beside the code. Every subcommand is offline: none opens a connection, executes DDL, or calls a provider, and `design init` is the only writer — to the explicit `--output` path, refusing to overwrite. `validate` is fail-closed, so `render`, `diff`, and `propose` refuse to work while `error` findings remain; `render` emits `json`, `markdown`, or `mermaid`.
- **Design drift comparison and review-only proposals.** `design diff` and `design propose` compare the artifact against the local schema cache (`--against-cache`) or local ORM definitions (`--against-orm`, supporting Prisma, DDL, Drizzle, TypeORM, Sequelize, and JSON), with `--orm-format` and `--ignore` for control. `propose` turns drift into a plan a human reviews and never applies a write: each entry carries a `dry-run` or `migration-review` safety level plus `preflight`, `rollback`, and `verification` steps.
- **Two further design review rules.** `REVERSE_RELATIONSHIP` (error) fires when the same endpoints are declared again in the opposite direction, and `PREFIX_REDUNDANT_INDEX` (warn) fires when a non-unique index is a leading-column prefix of a longer index.
- **Passive slow-query hint on `query` and `q`.** At or above `--slow-ms` (default 1000, `0` disables), a finished query gains a Performance hint footer and `metadata.performanceAdvisory`. It reuses the execution time already measured — no `EXPLAIN`, no schema read, no second request. The recommendation is engine-aware: PostgreSQL, MySQL, MariaDB, and Redis are pointed at `guide slow-query`; MongoDB and Elasticsearch state the timing instead. `--recovery` suppresses the hint so that envelope keeps its contract.

### Changed

- **Skill reference documents the new surface.** `skills/dbcli/reference.md` gains the `design` section (subcommands, artifact shape, finding codes and severities, the review-only `propose` contract, and workflows) plus the `--slow-ms` flag and the `metadata.performanceAdvisory` shape, disambiguated from the proxy flag of the same name.

### Tests

- Gherkin CLI workflow coverage for workspace inspection, blacklist review, and the verification prune dry run.

## [1.51.2] - 2026-08-07 - Intent confirmation for business requests

### Added

- **Per-request agent intent confirmation.** Installed dbcli skills now support `auto` (default), `confirm`, and `guided` conversational preferences for business-language database requests. Agents ask only result-changing questions, carry confirmed answers forward, and disclose material assumptions when explicitly asked to decide without further questions. These preferences are not persistent CLI configuration and never bypass schema, blacklist, permission, dry-run, production-selection, or write-confirmation gates.

## [1.51.1] - 2026-08-07 - Proactive semantic context discovery

### Changed

- **Agent skills now surface semantic context before users have to discover it.** When a request uses business aliases, metrics, recurring terminology, or relationship/join intent, installed dbcli skills first check `skill context`; they use validated semantic vocabulary when available, otherwise fall back to the blacklist-filtered schema and explain that `dbcli.semantic.json` is an optional way to keep future requests consistent. Skills never create, update, or migrate the file without explicit human instruction.

### Fixed

- **Release formatting gate.** Remove an extra closing brace from the static guides stylesheet so Prettier can parse the repository and the release gate can run.

## [1.51.0] - 2026-08-07 - Local semantic context and offline query-draft validation

### Added

- **Business semantic context commands.** Add the offline, read-only `dbcli semantic validate`, `context`, `search`, `drift`, and `migrate` commands for a reviewable `dbcli.semantic.json`. Semantic models, metrics, aliases, and v2 relationships are checked against the cached visible schema and saved-query names; v1 files remain supported and `migrate --to 2` writes only to stdout.
- **Deterministic governed semantic search and relationship drift checks.** `semantic search` returns only reviewed metadata, removes blacklist names from free-text results, and supports bounded result counts. `semantic drift` identifies stale, invalid, or unavailable local semantic evidence, including relationship references that no longer match declared visible fields.
- **Offline validation boundary for agent query drafts.** `dbcli semantic draft validate --input <file|->` accepts an explicit untrusted JSON draft and validates its references and read-only SQL without executing it, persisting it, or calling a provider. Reports contain hashes, canonical references, and safe violation codes rather than candidate SQL; a successful validation is explicitly not permission to execute.
- **Semantic context in agent-facing skill context.** `dbcli skill context` includes the validated semantic context when present, after blacklist filtering, so agents receive only governed schema and semantic metadata.

## [1.50.0] - 2026-08-06 - QueryLens proxy query analysis

### Added

- **QueryLens Markdown report for `dbcli proxy analyze`.** `dbcli proxy analyze --format markdown` now produces a shareable report covering query volume, latency percentiles, expensive fingerprints, slowest queries, errors, and N+1 suspects. It reads the proxy JSONL log offline and includes its rotated segment unless `--no-include-rotated` is supplied.

### Security

- **QueryLens redacts report literals independently of capture configuration.** The Markdown path analyzes an in-memory redacted copy of SQL-bearing events, including error messages, so a legacy log captured without `--redact literals` does not expose those values in the report. Use `dbcli proxy <engine> --redact literals` as well to protect the event log itself.

## [1.49.0] - 2026-08-06 - 欄位遮罩涵蓋攤平與陣列列，且不再為每條規則掃過整個結果集

延續 1.48.0 的 blacklist 主題：那一版修的是「哪些物件受保護」，這一版修的是「受保護的欄位到底有沒有真的被遮掉」，以及遮罩本身的成本。兩條安全性修復都屬於 fail-open —— 資料原樣回傳，其中一條連安全通知都不會發。

### Added

- **`dbcli proxy analyze` — 各區塊行動化(commands + hints),銜接 AI agent 介入。** `errors[]` 新增 `tables`,並附 `suggestedCommands`(`dbcli schema <table>`,最多前 3 表)+ `hints`(先核對表名/欄名再修正,勿臆測欄名);`repetition[]` 新增 `statement` 與可執行的 `exampleSql`(取最慢一筆),SELECT 群組附 `explain` / `guide missing-index-for` 的 `suggestedCommands`,每組附 N+1 批次化/快取的 `hints`。text 輸出彙整為 `SUGGESTED COMMANDS` 與 `HINTS` 區段;JSON 將建議附在各發現上。沿用 inspect 的 `suggestedCommands` + `hints` 雙軌慣例。skill 與使用者文件同步說明「analyze 後的 agent 行動流程」。

### Security

- **黑名單指定父欄位時，攤平後的子欄位未被遮蔽，而且不發通知。** Elasticsearch adapter 會把 `_source` 遞迴攤平成帶點的頂層鍵（`{profile:{ssn}}` → 鍵 `profile.ssn`，文件裡根本沒有 `profile`），而遮蔽判斷是以欄位名等值比對，因此把 `profile` 列入欄位黑名單完全沒有作用：資料原樣回傳，且因為「已遮蔽欄位」清單是空的，連安全通知都不會發出 —— 使用者不會知道有東西本來該被藏起來。影響 `query` / `q` / `export` 三條 Elasticsearch 路徑。現在任何位於黑名單祖先之下的欄位都會被遮蔽（`profiles`、`profile_name` 這類僅前綴相似的欄位不受影響）。已知天花板（規則指定葉節點名、或祖先不從路徑開頭起算）記於 `docs/security-threat-model.md`。

- **欄位遮罩把「列本身是陣列」當成 record，遮蔽通知發了但資料沒被拿掉。** 判斷「這個欄位在不在」的 `readPath` 把陣列當透明容器往裡面找，但實際執行遮蔽的 `cloneRecord` 把它當 record，於是索引變成鍵、元素裡的敏感欄位原封不動 —— 一列被回報為已遮蔽，卻是完整回傳的。兩邊現在都看穿陣列（含巢狀陣列）。目前沒有任何 adapter 會回傳陣列列，所以這是把「偵測」與「移除」兩半釘在同一個答案上，而不是修一個可觸發的洩漏。

### Performance

- **欄位遮罩對每一列的每一個欄位各複製一次整列。** `omitFieldPaths` 逐一路徑呼叫 `omitPath`，而後者每次都重建整個 record，因此成本是 O(列數 × 遮罩欄位數) 次完整複製 —— 100 列對上 50 個遮罩欄位就是 5000 次。沒有點的路徑只會刪掉一個頂層鍵，而欄位黑名單絕大多數就是這種名稱，現在合併成一趟處理，只有真正的巢狀路徑才遞迴。輸出完全相同，實測 30.37ms → 1.73ms。任何回傳大量資料又設有欄位黑名單的查詢或匯出都會受益。

- **黑名單規則多、命中少時，遮罩層對每條規則掃過整個結果集。** 判斷一條規則有沒有東西要遮，會對每一列呼叫一次 `hasFieldPath`，而它每次都重跑一遍 `path.split('.')`。掃不到表名的 fail-safe 分支會把設定裡的**每一條**規則都套上來，所以「規則多、命中少」正是它的常態形狀：60 條帶點且完全不命中的規則對上 1000 列，實測 12.10ms，而真正遮掉的只有一個欄位。現在沒有點的規則直接由既有的欄位集合精確回答，帶點的規則只在「開頭那一段在某列真的是物件或陣列」時才走訪列 —— 這與 `readPath` 本來就會判斷的條件相同，只是每條規則判一次而不是每列判一次；而讀取欄位值（比只列出名稱貴約 4 倍，也會觸發列物件上的 getter）只在黑名單裡真的有帶點規則時才做，所以常見的純欄位名黑名單反而比修改前更快。輸出完全相同，實測 12.10ms → 0.70ms，一般查詢的遮罩 0.69ms → 0.53ms。

### Changed

- **效能基準改為阻擋 CI。** `ci.yml` 的 `continue-on-error: true` 是那兩條基準能失敗四個月沒人發現的原因，已移除。同時每條基準都改為取多次量測的中位數並印出實測值，預算也依**實際 runner** 的數字重訂（最慢的 windows-latest 1.3.3 量到 3.25ms，原本 5ms 的預算只剩 35% 餘裕，放寬到 8ms）。一個會被強制執行的寬預算，勝過一個被忽略的嚴預算。

### Fixed

- **兩條效能基準自 2026-03-26 加入起就沒通過過。** 它們被 `ci.yml` 的 `continue-on-error: true` 蓋住，所以 CI 從未因此變紅，超標 6 倍也沒人看見。門檻本身是合理的（修正後餘裕 3 倍），問題在上面那條實作。基準也改為取多次量測的中位數並印出實測值：單次 `performance.now()` 加硬門檻約每三次就會誤報一次，當不了 gate。

## [1.48.0] - 2026-08-05 - blacklist 涵蓋語句中的每一張表，以及所有執行路徑（安全性修復）

對應 issue [#23](https://github.com/CarlLee1983/dbcli/issues/23)。與 1.47.1 修掉的六個繞過不同，這一批洩漏的是**讀取內容**，不是寫入能力。

### Security

- **blacklist 只檢查 SQL 的第一張表。** 擋下與遮罩都以單次 regex match 取得的單一表名為準，因此只要敏感表是經由 `JOIN`、逗號、`UNION` 或子查詢進入查詢，它既不會被擋、欄位也不會被遮罩。在 `users` 已列入 blacklist 的設定下，`SELECT * FROM users` 會被擋，但 `SELECT o.id, u.password_hash FROM orders o JOIN users u ON u.id = o.user_id` 會照常回傳 `users` 的敏感欄位。繞過不需要任何特殊語法，一個 `JOIN` 就夠，且在 `query-only` 權限下即可利用。影響 `query` / `export` / `q` / REPL 等所有 SQL 路徑。
- **`export` 的 SQL 路徑完全沒有套用 blacklist。** 該路徑建立 `QueryExecutor` 時把 validator 傳成 `undefined`，因此連單表的情況都不擋、不遮罩：`dbcli export "SELECT * FROM users" --format json` 會把已宣告為敏感的欄位原樣寫進檔案。
- **`export` 的 Elasticsearch 路徑檢查 index 但不遮罩欄位。** 同一個 index 上 `dbcli query` 會遮蔽的欄位，`dbcli export` 會寫進檔案。
- **`dbcli report` 完全沒有套用 blacklist。** 它直接呼叫 adapter 執行 snippet，而 collector 會載入使用者可寫的 snippet 目錄（不只內建），回傳的 rows 會被嵌進報告。既不擋黑名單資料表，也不遮罩欄位。
- **`dbcli q --verify` 的第二段查詢未經檢查。** blacklist 只套用在 snippet 本體，frontmatter 的 `verify.query` 是另一段直接送到 adapter 的 SQL。
- **互動式 shell 從未套用 `blacklist.columns`。** REPL 不走 `QueryExecutor`，它把 adapter 回傳的 rows 直接格式化輸出，因此 `dbcli shell` 裡的 `SELECT * FROM users` 會完整回傳 `dbcli query` 會遮蔽的欄位。
- **MongoDB 的 `$lookup` / `$unionWith` 從未被檢查。** 這是 #23 的 MongoDB 寫法：指令指定一個 collection，pipeline 卻讀另一個。`query` / `export` / `q` 三條路徑都只檢查被指名的那個 collection，因此 `$lookup: { from: 'secrets' }` 既不被擋，嵌入的欄位也不被遮罩。現在會遞迴讀取 `$lookup.from`、`$unionWith.coll`、`$graphLookup.from`、`$out`、`$merge.into`（含 sub-pipeline），並把來源 collection 的欄位規則重新錨定到 `as` 指定的巢狀路徑。
- **字串常值的反斜線解讀會讓掃描器失步。** 表名列舉先前假定反斜線不轉義引號，理由是「提早結束字串只會讓更多文字可見」—— 這個推理是錯的：提早結束會翻轉引號奇偶性，於是下一個引號開啟一段直到輸入結尾的偽字串，把整個 `FROM` 子句藏起來。`SELECT E'\'' AS x, * FROM secrets` 在 `query-only` 下即可取回整張黑名單資料表。現在兩種解讀都掃描並取聯集。
- **PostgreSQL 的 `U&"\0073ecrets"` 未解碼。** 回報的是原始文字，而伺服器解析出的是 `secrets`，因此擋下與遮罩都被繞過。`UESCAPE` 允許以幾乎任何字元代替反斜線（只要不是十六進位數字、`+`、引號或空白），包含一般字母，因此 `U&"x0073ecrets" UESCAPE 'x'` 是純英數字串；現在會對每個合法的 escape 字元各解碼一次。
- **⚠️ 非 ASCII 的 dollar-quote 標籤造成權限繞過（不只 blacklist）。** dollar-quote 的標籤依「未加引號的識別字」規則，而 PostgreSQL 識別字接受高位元組，因此 `$é$ … $é$` 是真正的字串；但語句剖析器的標籤樣式只接受 ASCII，於是該區段被當成一般文字，裡面的 `'` 開啟一段直到輸入結尾的字串，把後面整批語句藏起來。**在 `permission: query-only` 下，`SELECT $é$ ' $é$ ; DROP TABLE users; -- ` 會通過權限判定並送到資料庫。** 這條在 1.47.0 以前就存在，與 1.47.1 修掉的 `a$q$` 是同一族 —— 當時修了識別字延續字元的判定，沒有修標籤本身。詞法邊界規則已抽到 `src/utils/sql-lexical.ts` 由兩個掃描器共用，因為同一條規則已經三次在一個檔案修、另一個沒修。
- **Elasticsearch 的 `--index` 是運算式而非名稱。** 它接受逗號清單、萬用字元、`_all`、百分比編碼（`%2A`）、date math（`<logs-{now/d}>`）與跨叢集限定（`cluster:index`），因此 `--index "secrets,orders"`、`"*"`、`"sec*"`、`"_all"`、`"<secrets>"`、`"*:secrets"`、`"%2A"` 全都能讀取黑名單 index 而不與任何黑名單項目相等。`query` / `export` / `q` / ES shell **四條**路徑皆受影響。現在會正規化運算式後逐一檢查具名 index，萬用字元則在「可能匹配到黑名單 index」時拒絕。
- **同一個問題也讓欄位遮罩整個失效。** 遮罩仍以原始運算式做等值查表，因此 `--index "us*"` 或 `"users,orders"` 匹配不到任何欄位規則 —— 在只設定欄位黑名單（資料表本身未列入）時，`checkIndexBlacklist` 會放行，然後所有受保護欄位原樣回傳，`export` 更會寫進檔案。現在改以「該運算式可能觸及的所有 index 的規則聯集」遮罩。
- **ES 目標的比對讀的是原始文字，不是伺服器實際路由的路徑。** `%5F` 是 `_`、`%2F` 是 `/`、`..` 會退一層，因此 `GET /%5Fsearch`（實為 `/_search`）、`/secrets%2F_search`（實為 `/secrets/_search`）、`/_cat/../secrets/_search` 全都通過檢查。另有 `_ALL` 大小寫、`%252A` 雙重編碼、`<<secrets>>`、`c:d:secrets`、`secrets:` 等拼法在 `--index` 上同樣繞過。現在路徑會先解碼並解析（重複至穩定）再檢查，且**任何一段**命中黑名單 index 就拒絕 —— `/_cat/indices/secrets` 不讀文件，但黑名單保護的是物件本身。正規化規則抽到 `src/utils/es-index-target.ts` 由 validator 與 shell 共用。
- **ES shell 只看路徑，request body 指名的 index 完全未檢查。** `_mget` 的 `docs[]._index`、`_bulk` action 的 `_index`、`terms` lookup 的 `index` 都能指向黑名單 index —— 把路徑指向無害的 index，正好讓這些端點重新打開。
- **ES shell 的「未指名 index 即拒絕」讀的是原始路徑，其餘檢查讀的是解析後路徑。** 因此 `GET /_cat/../_search`、`/_ingest/../_sql`、`/_license/../_msearch` 只要前綴在允許清單內就放行，而 HTTP 客戶端會把 `..` 解掉，實際送出的是未界定的 `_search`。現在檢查與送出的是同一個字串，且路徑的文字與路由結果不一致時直接拒絕。
- **ES shell 的欄位遮罩保護的是鍵名，不是值。** Elasticsearch 會把欄位值放在**請求指定**的鍵底下回傳：`{"sort":["password"]}` 一個請求就能依序取回整欄，`aggs.*.field`、`script_fields`、`docvalue_fields`、runtime field 同理，都不需要 scripting 權限。現在請求本體中只要出現受保護欄位名（含字串內以非識別字切出的片段）即拒絕，遮罩回應則作為第二道。
- **Elasticsearch data stream 與 rollover 的支撐 index 名稱不同，等值比對蓋不到。** `.ds-secrets-2026.08.05-000001`、`secrets-000001` 都能讀到 `secrets` 的資料。現在依命名慣例一併涵蓋。**alias 仍是天花板** —— alias 指向哪個 index 是伺服器端知識，且 `GET /_cat/aliases` 會揭露對應關係；已記入威脅模型。
- **request body 中陣列型的 `index` / `_index` 未被檢查**（`_msearch` 標頭、`_reindex` 的 `source.index` 都接受陣列）。
- **`globToRegex` 的字元類別掃描不理會轉義**，`[a\]b]` 被讀成字面字串而非「a、]、b 三選一」的類別。
- **ES shell 完全沒有欄位遮罩。** `dbcli query --index users` 會遮蔽的欄位，ES shell 原樣回傳。現在回應中任何名稱命中欄位黑名單的鍵一律移除（不論深度）—— ES 回應是任意文件結構，與其為 `hits.hits` 等各種外層建模，不如從嚴。
- **ES shell 對任何未指名 index 的路徑完全跳過檢查。** 路徑第一段以 `_` 開頭時取不到 index，於是 `GET /_all/_search`、`/_search`、`/_msearch`、`/_mget`、`/_sql` 全都放行 —— 它們都會讀到黑名單 index 的文件。現在：有設定黑名單時，無法界定 index 的請求一律拒絕，僅以**允許清單**放行純叢集中繼資料端點（`_cat`、`_cluster`、`_nodes`、`_tasks`、`_ingest`、`_license`），因為改用拒絕清單就得窮舉現在與未來所有會回傳文件的端點。
- **`export` 的 ES 路徑先取資料才檢查 blacklist。** 雖然不會寫出檔案，但黑名單 index 已被查詢、scroll context 已被開啟。檢查已移到抓取之前。
- **MongoDB 巢狀 `$lookup` 的遮罩前綴不含巢狀層級。** `$facet` 分支或 `$lookup.pipeline` 內的 `$lookup`，文件實際落在 `fb.sec.*` / `outer.sec.*`，規則卻被錨定在 `sec.*`，因此不會遮罩。
- **同一個 collection 被 join 兩次時只有第一次被遮罩。** 前綴是以「尚未見過的 collection」為單位記錄的，因此 `$lookup ... as: 'first'` 與 `$lookup ... as: 'second'` 只產生一組前綴，`second.token` 外洩。
- **⚠️ 修復本身引入的回歸（已修）：dollar-quote 判定改為「必須以可起始識別字的字元開頭」之後，數字後接識別字的情況被誤判。** `1a$q$` 在 PostgreSQL 是數值常值 `1` 加上識別字 `a$q$`（`$` 被吸收、不開引號），但新規則只看第一個字元、把整串當成數字，於是**憑空造出一個 dollar-quote**，`SELECT 1a$q$ ; DELETE FROM secrets ; SELECT 1 AS z$q$` 在 `query-only` 下通過。判定改為：以識別字字元開頭則吸收；`$` 開頭是位置參數；數字開頭則先吃掉數值前綴，若其後仍有識別字字元就吸收。
- **PostgreSQL 中 dollar-quote 接在位置參數之後未被識別。** `$1$q$` 裡的 `$1` 是參數而非識別字，但判定只排除「以數字開頭」的字元串，`$` 開頭的被當成識別字，於是 `$q$` 未被識別、裡面的 `'` 再次讓掃描失步。判定改為「該字元串必須以可*起始*識別字的字元開頭」。目前不可利用（`query.ts` 一律傳空參數，`$1` 在伺服器端是語法錯誤），支援參數綁定後即會成為實洞。
- **`globToRegex` 對轉義的字面量比對過少。** `sec\*` 應保護鍵 `sec*`，卻編譯成可比對 `sec\x` 而比不到 `sec*` —— Redis key 黑名單的樣式在這個方向上是會洩漏的。
- **PostgreSQL 中 dollar-quote 接在數字之後未被識別。** 只有*識別字*會吸收後面的 `$`：`1$q$` 是數值常值加上真正的 dollar-quote，`a1$q$` 則是單一識別字。原本只看前一個字元，兩者分不開，於是該引號未被識別、裡面的 `'` 再次讓掃描失步。

除前兩條外，其餘皆是在修 #23 的過程中、經由列舉「哪些路徑直接呼叫 adapter」與七輪對抗性審查找出來的 —— 與 1.47.1 的教訓相同：這類缺陷表現為**未設防的路徑**，不是缺少機制。

### Changed

- **⚠️ 行為收緊：語句只要參照到任何一張黑名單資料表就會被擋下。** 過去只有排在最前面的那張表算數。升級後，先前能執行的跨表查詢（JOIN / 逗號 / UNION / 子查詢帶進黑名單表）會開始被拒絕 —— 那正是原本應該被擋的行為。
- **⚠️ 遮罩改以「所有被參照的表」的欄位規則聯集計算。** JOIN 結果的欄位名不帶表限定（`u.password_hash` 回傳成 `password_hash`），無法從結果反推欄位屬於哪張表，因此只要**任何一張**被參照的表把該欄位列入黑名單就遮蔽。
- **⚠️ 表名列舉刻意過度回報，可能誤擋。** 新的 `src/utils/sql-tables.ts` 除了走訪 `FROM` / `JOIN` / `INTO` / `UPDATE` / `USING` / `TRUNCATE` / `COPY` / `STRAIGHT_JOIN` 等位置，**還會把語句中每一個非保留字的識別字都列為候選表名**。這表示：若某個欄位名、別名或函式名剛好等於一張黑名單資料表的名稱，該語句會被擋下。這是刻意的取捨 —— 歷次對抗性審查各自都在「精確走訪」版本裡找到新的文法角落（`{ oj … }`、`STRAIGHT_JOIN`、`FROM a USE INDEX (i), secrets`、`ANALYZE t`、`U&"t"`），與 1.47.1 記錄的天花板是同一個模式，因此保證不建立在走訪完整之上，而建立在「表名是識別字，而每個識別字都會被回報」。被擋時錯誤訊息會指出是哪個名稱命中 —— 實務上會遇到的情形是：黑名單有一張叫 `token` 的資料表時，`SELECT t.token FROM api_keys t` 會被拒絕。
- **保留字清單只留三種方言都保留的字**（38 個）。 這是列舉唯一會 fail-open 的地方：清單裡的字若在某個方言其實可當未加引號的表名，那張表就隱形。`FILTER` / `PARTITION` / `SET` / `CURRENT` / `UPDATE` / `DELETE` / `INSERT` / `NULLS` / `OVER` / `EXISTS`、`RLIKE` / `XOR` / `ILIKE` / `STRAIGHT_JOIN`，以及 `BETWEEN`（PostgreSQL 的 `col_name_keyword`，`ColId` 接受）與 `EXCEPT` / `INTERSECT`（MySQL 8.0.31、MariaDB 10.3 才成為保留字）皆已移除 —— 每一個都在某個支援的方言裡是合法表名。
- **語句在所有歧義解讀下各掃描一次並取聯集。** 反斜線是否轉義引號取決於伺服器模式，未宣告方言時註解規則也不同。挑一種解讀正是失步繞過的成因。
- **無法辨識出資料表時，遮罩套用全部欄位規則而非不套用。** 過去（以及本次修復的第一版）在表名解析不出來時直接跳過遮罩，等於把任何解析缺口變成洩漏。
- **`query` 的大小防護不再對 schema 限定名靜默失效。** 舊的單次比對對 `FROM public.users` 回傳 `public`，那不是 schema 快取的鍵，於是防護整段被跳過。

### Fixed

- **`snapshot` 記錄的 redacted 欄位清單過去只取第一張表**，與實際遮罩的範圍不一致。
- **表名列舉在長 dotted chain 上是二次成長**（16 KB 的 `a.a.a…` 要 320ms，125 KB 要 22 秒）。改為單趟走訪後同一輸入為 2ms。
- **`decodedVariants` 對「相異字元數」是二次成長**（40 KB 的識別字要 3.4 秒）。改為單趟同時解碼所有合法 escape 字元後，同一輸入為 4ms。
- **`globToRegex` 遇到無法解析的字元類別（`[\]*`）會拋 `SyntaxError`**，從安全檢查裡竄出去而不是回答它。
- **識別字中超出 Unicode 上限的 escape 會讓掃描整個拋例外。** `\+FFFFFF` 是 16777215，`String.fromCodePoint` 會丟 `RangeError`；而 `"` 在所有方言都被當識別字引號，因此任何含該樣式的 MySQL 字串（例如 Windows 路徑）都會讓指令中斷。

### Known limits

以下三類都會取回黑名單保護的**值**，但不會提到黑名單物件的名字，因此列舉表名的作法看不到它們。已記入 `docs/security-threat-model.md`：

- 改名或轉換：`SELECT password_hash AS x FROM users`、`substr(password_hash,1,10)`、`to_json(u)`、MongoDB 的 `$project: { stolen: '$sec.token' }`。**資料表層級的項目可強制執行；欄位層級的項目是顯示過濾，不是存取控制。**
- 經由 view 或函式間接：`SELECT * FROM v_users` 只提到 `v_users`，那個 view 讀的是 `users` 屬於伺服器端知識。
- 伺服器端語句文字：`PREPARE s FROM 'SELECT * FROM secrets'` + `EXECUTE s`。兩者都分類為 `UNKNOWN`，`admin` 以下會被權限擋掉；`admin` 在 shell（單一 session 跨提示存活）可以執行。這與 1.47.1 已記錄的「字串傳遞的 SQL」是同一個天花板。

黑名單擋的是一般讀取，不是「值無法被重建」的證明。真的不該讀某欄位的帳號，需要資料庫授權來說這件事。

## [1.47.1] - 2026-08-05 - 唯讀保證涵蓋所有執行路徑（安全性修復）

決策記錄：`docs/adr/0004-database-access-stays-a-cli-surface.md`。

### Security

修復六個「看起來是讀、實際會寫」的繞過，它們都能在設定為 `permission: query-only` 的連線上寫入資料。**建議所有把資料庫交給 AI agent 操作的使用者升級。**

- **MongoDB `$out` / `$merge` 未被擋下（`query`、`q`、`export`）。** 這兩個 aggregation stage 只在多連線 fan-out 路徑被檢查，單連線 `dbcli query`、saved snippet、以及 `dbcli export` 全都會執行它們，不論 permission 等級。`$out` 可覆寫任意 collection。`--dry-run` 會把這種 pipeline 預覽成安全操作。影響 MongoDB 連線。
- **PostgreSQL 多語句堆疊。** 權限分類只讀第一個關鍵字，而 PostgreSQL 的 simple query protocol 會執行字串裡每一個以分號分隔的語句，因此 `SELECT 1 LIMIT 1; DELETE FROM users` 會以 SELECT 的身分通過 `query-only`。影響 PostgreSQL；MySQL / MariaDB 走 prepared statement，不受影響。
- **snippet 的偽唯讀語句。** snippet 只要求開頭是 `SELECT` 或 `WITH`，因此 `WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x` 與 `SELECT … INTO` 都能通過。一個 commit 進 repo、看起來是唯讀報表的 `.sql` 檔可以寫入資料庫。影響 PostgreSQL / MariaDB。
- **snippet frontmatter 的 `verify.query` 未經驗證。** 過去只檢查它是非空字串，然後由 `dbcli q <name> --verify` 原封執行。
- **唯讀證明只接在多連線 fan-out 上，單連線 `query` / `export` / REPL 沒有。** 權限判定只看第一個關鍵字，因此 `query-only` 連線接受並執行下列語句：`WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone`（data-modifying CTE）、`SELECT * INTO evil_copy FROM users`（建表）、`EXPLAIN ANALYZE DELETE FROM users`（`EXPLAIN ANALYZE` 會真的執行該語句）。同一句 SQL 加上 `--use a,b` 會被擋，不加就執行。auto-limit 補的 `LIMIT 1000` 對 CTE 無效，整張表仍會被刪。**這條在 1.47.0 以前就存在**，且不需要任何特殊語法。影響 PostgreSQL 與 MariaDB。
- **PostgreSQL 識別字中的 `$` 被誤判為 dollar-quote 起點。** PostgreSQL 的識別字從第二個字元起允許 `$`，因此 `a$q$` 是**一個識別字**；但語句剖析器把它讀成字串起點，於是 `SELECT 1 AS a$q$ LIMIT 1; DELETE FROM users; SELECT 1 AS b$q$` 中間整段對所有安全檢查隱形，資料庫卻照常執行三段。**這條在 1.47.0 以前就存在**：多連線 fan-out 的唯讀斷言（`dbcli query --use a,b`）用的正是同一個剖析器，因此可被此手法繞過。影響 PostgreSQL。

利用這些繞過需要能下達指令的一方送出 payload，也就是 agent 本身 —— 而 dbcli 的威脅模型前提正是 agent 不完全可信，因此這些屬於權限繞過，不以「使用者自己下的指令」論。

### Changed

- **⚠️ 行為收緊：開頭讀取但夾帶寫入的語句一律需要 `admin`。** 例如 `WITH x AS (INSERT … RETURNING *) SELECT …`、`SELECT … INTO`、`EXPLAIN ANALYZE <寫入>`、`DESCRIBE ANALYZE <寫入>`（`DESCRIBE` 在 MySQL/MariaDB 是 `EXPLAIN` 的同義字）。過去這些一律不檢查；中間曾嘗試「比照該寫入的等級」，但那需要為 `INSERT INTO` 的 `INTO` 加文字例外，而例外之間會互相作用出新的繞過，因此改為單一規則。**升級後需要改用 `admin` 的用法有三類**：`data-admin` 連線上的可寫 CTE；對寫入語句做 `EXPLAIN ANALYZE` / `DESCRIBE ANALYZE` 效能分析（它會真的執行該語句）；以及 MySQL/MariaDB 的 `SELECT … INTO @variable`——後者其實是純讀取，只是與 PostgreSQL 會建表的 `SELECT … INTO <table>` 共用關鍵字，為它加例外正是本次反覆出問題的來源，因此選擇留下這個誤擋。被擋時的錯誤訊息會指出是哪一個關鍵字觸發的。 不含 `ANALYZE` 的 `EXPLAIN` 只做計畫、不執行，維持唯讀；`SHOW` / `DESCRIBE` 不接受子查詢，因此 `SHOW CREATE TABLE users` 仍是讀取；`replace()` / `TRUNCATE()` / `INSERT()` 是函式不是語句，維持唯讀。
- **admin 以下的權限等級拒絕多語句 SQL。** 因為只有第一個語句會決定權限判定。`admin` 不受影響（它本來就允許所有語句類型）。分隔符依**該連線實際的方言**判定：`$$…$$` 只在 PostgreSQL 是字串、反引號只在 MySQL/MariaDB 引號化識別字、`#` 只在 MySQL/MariaDB 起始註解（在 PostgreSQL 是運算子）。方言未知時從嚴。
- **snippet 的唯讀證明依 `engine` 宣告的方言判定。** 因此 `SELECT \`update\` FROM t`（MySQL 反引號識別字）、`# drop …` 註解、`a.create` 這類欄位名不再被誤判為寫入；`FOR UPDATE` / `FOR SHARE` 是取鎖的讀取，同樣不算寫入。
- **無法解析的 snippet 只跳過該檔並發出警告，不再讓整個 snippet 目錄失效。** `queries check` 仍會回報它們並以 exit 1 結束。
- **snippet 一律拒絕寫入關鍵字。** snippet 依合約唯讀，這條規則不看 permission 等級，`admin` 連線亦然。
- **MongoDB 寫入 stage 在單連線 `query` 需要 `data-admin` 以上；在 snippet 與 `export` 一律拒絕。**

### Added

- **執行路徑契約測試。** `src/adapters/` 以外每一處 `<x>Adapter.execute(...)` 都必須登記它倚賴的 gate，未登記的新路徑會讓測試失敗。這六個洞裡有兩個正是靠列舉全部路徑才發現的 —— 逐一稽核指令找不到它們。

## [1.47.0] - 2026-08-05 - 連線逾時可設定

決策記錄：`docs/adr/0003-connection-timeout-override-resolved-at-adapter-construction.md`。

### Added

- **新的 root-level 全域旗標 `--timeout <ms>`。** 覆寫連線設定中的 `timeout`；兩者都沒有時沿用各 adapter 內建的 5000ms。合法值為 100～600000 的整數，須放在子指令之前（和 `--global` / `--use` 一樣是 root-level flag）。對所有引擎有效，典型用途是 MongoDB 跨 VPN 或連 Atlas 時，預設 5 秒的 server selection timeout 太緊：`dbcli --timeout 20000 --use <conn> list`。這個覆寫只在建立連線時套用，不會寫回設定檔；要永久生效請在連線設定裡寫 `timeout` 欄位。
- **連線設定檔新增 `timeout` 欄位。** 四種連線 schema 皆支援，毫秒、100～600000 整數、可省略。

### Changed

- **設定檔驗證失敗的錯誤訊息改為可讀格式。** 過去會吐出整包 Zod `unionErrors` 巢狀 JSON；現在只列出與該連線 `system` 相符的分支問題，逐欄列出欄位路徑。
- **文件明確禁止 `2>&1`。** 診斷訊息走 stderr、結果走 stdout，合併兩者會讓 `--format json` 的輸出無法解析；SKILL 與 reference 都補上導管寫法。

## [1.46.0] - 2026-08-04 - MongoDB 逐欄連線設定

決策記錄：`docs/adr/0002-mongodb-connection-field-first-config.md`；規格：`docs/specs/2026-08-04-mongodb-field-first-connection.md`。

### Changed

- **⚠️ BREAKING（互動流程）：`dbcli init` 對 MongoDB 改為先問「連線設定方式」。** 過去第一個提問是 MongoDB URI，留空才退回逐欄詢問 —— 於是逐欄路徑事實上沒人走，所有文件也只教「整條 URI 貼進去」。現在預設是「逐欄填寫」，貼 URI 降為明示的進階選項。**設定檔格式向下相容**，既有含 `uri` 的設定不需修改；`--uri`、`--no-interactive` 等非互動用法行為完全不變，只有互動提問的順序改變。
- **逐欄模式在有帳號時會明確寫出 `authSource`。** 過去只有帶 `--auth-source` 才會（而且寫了也會被 schema 丟掉），現在未指定時會寫入 `admin`。連線結果與過去等價（adapter 本來就以 `admin` 為預設），但設定檔內容會多這一行 —— 包含 `--no-interactive` 的既有腳本。
- **`uri` 與逐欄欄位仍是 `uri` 優先，但不再靜默。** 兩者同時存在時 `dbcli doctor` 會發出 warning 指出逐欄值被忽略；`srv: true` 又指定非預設 `port` 也會 warning。這兩種設定過去都是「改了欄位卻沒生效」而無從診斷。

### Added

- **MongoDB 連線設定新增 `authSource` / `replicaSet` / `tls` / `srv` 四個欄位。** 過去這些選項只能塞進 `uri` 的 query string —— 這正是逐欄路徑不堪用的根因。其中 `authSource` 更微妙：runtime 型別與 `init --auth-source` flag 都存在，但 zod schema 沒有此鍵，`z.object` 會 strip 掉未知欄位，於是它落盤即遺失，只有 init 當下那次連線測試吃得到，等同一個死 flag。`srv: true` 會組出 `mongodb+srv://` 並沿用既有的 DNS SRV 展開（含 DoH fallback），讓 Atlas 這類最常見的雲端場景也能逐欄設定。`authSource` 與 `replicaSet` 支援 `{"$env": "..."}` 參照。
- **MongoDB 逐欄分支支援 `--use-env-refs`。** 過去 mongo 在 init 的 early-return 發生在 env-ref 分支之前，想用環境變數參照只能手改 `config.json`。現在五個 `--env-*` 旗標對 mongo 全部生效，密碼不必明文落盤。與 SQL 路徑的差異：mongo 只要求 `--env-host`，其餘留空即寫入字面值而不產生 `$env` —— 因為未定義的 `$env` 會讓之後每一個指令 fail closed，對無認證連線而言那是壞掉的設定。env-ref 模式同樣跳過連線測試（參照此時還沒有值可連），與 SQL 路徑一致。
- **連線失敗訊息按成因分類。** 認證失敗提示檢查 `authSource`（並說明 Atlas 與多數自架環境為 `admin`）、DNS/SRV 解析失敗提示 `srv` 設定與網路 DNS、TLS 握手失敗提示 `tls` 欄位與自簽憑證情境。原本三種情況共用同兩條泛用訊息。

### Fixed

- **逐欄模式的連線字串跳脫不完整。** `buildUri()` 原本只對 `password` 做 `encodeURIComponent`，`user` 與 `database` 直接字串拼接 —— 帳號含 `@`、資料庫名含 `/` 都會讓 driver 把 authority 切在錯的位置。現在三者一致跳脫，`host` 則改為驗證不含 `/@?#` 並在違反時明確報錯。
- **`host` 為空字串或含埠號、空白時會產出壞掉的連線字串。** `mongodb://:27017/db` 與 `mongodb://h:1234:27017/db` 過去都會被送進 driver，換來一個難懂的錯誤。現在在組字串前就擋下並說明埠號該填在 `port` 欄位。IPv6 位址需加方括號（`[::1]`），與 driver 的要求一致 —— 未加方括號的 `::1` 過去會組出 `mongodb://::1:27017/db`。同理 `authSource` 為空字串時會退回 `admin`，不再送出 `authSource=`。
- **連線失敗分類會被連線字串本身誤導。** driver 的錯誤訊息經常回吐原始 URI，而 `mongodb+srv://` 與這次新增的 `?tls=true` 正好含有 `SRV` 與 `TLS` 字樣 —— 用裸字串比對會讓一個單純的連線被拒歸類成 DNS 或 TLS 問題。改為優先讀 driver 的結構化 error code，訊息比對則收斂成 driver 實際會產生的片語。
- **只填 `user` 沒填 `password` 會靜默降級成無認證連線。** 原本的 `if (user && password)` 在密碼缺漏時直接落到無認證分支，錯誤會延後到伺服器端才浮現、且看起來像是權限問題。現在直接拋 `ConnectionError`，訊息說明補上密碼或一併清空 `user`。

## [1.45.1] - 2026-08-04 - Windows 上的 agent mode 修復

### Fixed

- **agent mode 在 Windows 上拒讀自己寫出來的 config。** `assertAgentReadableFile` 以 `(mode & 0o022) !== 0` 判斷 group/world-writable，但 Windows 的 `stat()` 回的是合成 mode —— 一般可寫檔一律 `0o666`，設了 read-only 位元才 `0o444`，低位元沒有 group/world 語意，`chmod` 也只能切換 read-only。結果 `DBCLI_AGENT_MODE=1` 時，Windows 上連 dbcli 剛寫入的 config 都被拒絕，agent 模式實際不可用（1.45.0 已含此問題）。同檔的 `bestEffortSecureMode` 註解早已寫明「Windows 沒有 POSIX mode bits，靠 content hash 保護」，這次把 assert 端對齊該立場：mode 檢查抽成 `refusesGroupOrWorldWritable(mode, platform)`，win32 放行，POSIX 行為不變。竄改偵測比對的是寫入時記錄的 content hash，與 mode 無關，因此安全性不受影響。連帶修好 2 個 config-binding tampering 測試 —— 同一根因：binding 讀取前先過這道閘門，拋出的是 writable 錯誤而非預期的 tampering 錯誤。

### Changed

- **移除 schema loader 的牆鐘時間斷言。** `initialize` 的 `loadTime < 200ms` 跑在阻擋性的 `bun test` 裡，但共用 CI runner 不是量測儀器（Windows 冷啟動 270ms 就紅，程式本身無異常）。改為斷言合約（有量到並回報 loadTime），時間預算歸 `tests/perf/*.bench.ts` —— CI 對該套件本來就設 `continue-on-error`，正因為 timing 依環境而定。
- **`docs/security-threat-model.md` 補上平台差異。** POSIX 用 `0o700`/`0o600` 保護設定，Windows 沒有等價 mode bits，機密性靠 profile ACL；竄改偵測兩邊一致。
- 這兩項修復讓 `windows-latest` CI job 自 v1.40.0 以來首次通過（6 個 matrix job + docs-parity 全綠）。

## [1.45.0] - 2026-08-04 - root-level `--global`：跨專案共用的 user-global registry

### Added

- **root-level `--global` 旗標。** 原本每條連線都綁在專案上：`init` 會在 `./.dbcli/config.json` 寫 binding stub，真正的設定落在 `~/.config/dbcli/projects/<project-id>/`。要在多個專案共用同一條連線，只能在每個 repo 重跑一次 `init`，或手動複製設定。`--global` 讓 `~/.config/dbcli/config.json` 成為一個獨立的 v2 registry：`dbcli --global init --conn-name shared ...` 直接寫進去、不建立也不修改專案 binding，`dbcli --global use --list` / `--global query` 則在不依賴當前目錄的情況下操作它。scope 必須明確選取 —— 未帶 `--global` 時一切照舊走專案 binding，避免在不相關的專案裡誤用全域連線。全域檔案沿用與 home storage 專案設定相同的私有檔案權限與 integrity record。
- **`getDbcliConfigHome()` / `getGlobalConfigPath()` / `isGlobalConfigPath()` 加入 `public.ts`。** 前者把 per-user root 改為延遲解析並支援 `DBCLI_CONFIG_HOME` 覆寫，測試與 embedder 不必 reload module 就能隔離 config home。

### Changed

- **`migrate` 與 `queries` 子指令補上 Commander `command` 傳遞。** 這兩處原本以 `resolveConfigPath(undefined, opts)` 解析設定路徑，看不到 ancestor 的 root-level 旗標 —— 沒有 `--global` 時症狀被 `.dbcli` 預設值蓋掉，加上 `--global` 後就會靜默讀錯 registry。現在 36 個 `resolveConfigPath` 呼叫點全部傳入 command。
- **`resolveConfigPath` 的優先序明確化。** 顯式 `--config` 仍最優先（`--global --config <path>` 因此是確定的），其次是顯式 `--global`，最後才是 `.dbcli` 預設值。

## [1.44.1] - 2026-08-02 - `agent-core` 的 `loadEnvFile` 改用 node:fs，可在 Node 執行

### Fixed

- **`loadEnvFile` 不再依賴 `Bun.file`。** `./agent-core` 存在的理由是給下游 agent CLI 共用，而那些工具不一定跑在 Bun 上；`loadEnvFile` 內部呼叫 `Bun.file()`，在 Node 下直接 `ReferenceError: Bun is not defined`，使整個匯出對第一個 Node 消費者（logq）不可用。改以 `node:fs/promises` 讀檔，解析與「不覆寫既有 `process.env`」的行為完全不變；檔案不存在仍拋 `ConfigError`。其餘五個匯出本來就沒有 runtime 相依，不受影響。

### Added

- **Node runtime 契約測試。** 本 repo 的測試全部跑在 Bun 上，所以 agent-core 裡的 Bun-only 呼叫對它們是隱形的 —— 這正是這個 bug 得以發布的原因。新增的契約測試會 spawn 真正的 `node` 行程去 import 建置後的 `dist/agent-core.mjs`，逐一呼叫每個匯出。還原修正後此測試會失敗（已驗證），因此這個失敗模式不會再次出貨。

### Changed

- **同步跨平台發版 metadata。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.44.1`。

## [1.44.0] - 2026-08-02 - agent-core 補上錯誤型別與 env reference 型別

### Added

- **`./agent-core` 匯出 `ConfigError` 與 `EnvReference`。** 下游工具原本無法用 `instanceof` 判別 env reference 解析失敗，只能比對錯誤訊息字串；也無法引用 `{ $env: string }` 的型別名稱，只能各自重複定義一個結構相同的介面。兩者都是既有模組早已匯出、只是沒有出現在 `public.ts` 的疏漏。runtime interface 因此從五項變六項，型別從三項變四項，皆為加法變更。

## [1.43.0] - 2026-08-02 - Agent Core、查詢完整性與跨平台修復

### Added

- **穩定的 `./agent-core` 子路徑匯出。** 以五個 runtime functions（env 載入、env reference、連線選取、名稱解析、lookahead 截斷）與三個型別形成 agent CLI 共用的 semver interface；`./core` 仍是 dbcli 專用介面。建置同時產出 ESM 與型別宣告，CI purity gate 禁止資料庫、adapter 或 CLI framework 相依滲入。
- **欄位投影 `--fields`。** SQL 與 MongoDB 通用；`--fields a,b` 取用、`--fields=-raw_response` 排除，兩種形式不可混用。MongoDB 會把 `projection`（find）或 `$project`（aggregate）下推給 driver，未明確指定時不回傳 `_id`。黑名單欄位不會因為被 `--fields` 點名而洩漏。
- **欄位值截斷 `--truncate`。** table 輸出預設在 120 個 Unicode code point 截斷並標記 `…(+N chars)`，以 code point 計數所以不會切壞中文與 emoji；`--no-truncate` 可關閉。`--format json` / `csv` 會拒絕此旗標而非靜默忽略。
- **從檔案或 stdin 讀查詢 `-f, --query-file`。** `-f -` 讀 stdin，可用 heredoc 傳含 `$regex`、巢狀日期物件的 MongoDB pipeline，完全避開 shell 引號問題。同時給檔案與位置參數會明確報錯。
- **單次連線指定。** 新增 `DBCLI_CONNECTION` 環境變數，`query` / `list` / `schema` / `export` / `check` 也接受子指令層級的 `--use`。優先序為 `--use` > `DBCLI_CONNECTION` > 儲存的預設值，兩者都不會改寫 `.dbcli/config.json`，因此平行執行不會互相污染。
- **唯讀多連線扇出 `--use a,b`。** 同一查詢對多個連線執行，JSON 回傳 `results` 陣列並逐一標示 `ok` / `error`，table 則分段標註連線名。單一連線失敗不會取消其他連線。彙總 exit code：全成功 `0`、部分失敗 `2`、全失敗或執行前拒絕 `1`。寫入語句、`--recovery`、`--ui` 與 CSV/HTML 輸出在扇出下一律拒絕。

### Changed

- **HTML dashboard 明示不完整與遮蔽結果。** `query`、`q` 與 HTML export 會把既有的截斷與 security metadata 傳入 dashboard；在 KPI、圖表與 raw table 之前顯示醒目提示，避免使用不完整資料得出結論。
- **截斷改為出現在結果本身。** dbcli 擁有的 row cap 會多取一列前瞻，因此能區分「剛好 N 筆」與「被砍到 N 筆」：table footer 顯示 `Rows: N (truncated; limit N)`、`--format json` 帶 `metadata.truncated` 與 `metadata.limit_applied`、CSV 附加 `# truncated; limit N` 註解行。`dbcli q` 的 snippet size guard 同樣依此回報，不再讓整數列數被誤讀為全集。
- **`dbcli export` 撞到 auto-limit 改為 fail closed。** 匯出檔沒有地方記錄資料被丟掉（jsonl 是一行一筆、MongoDB `--format json` 是裸陣列），stderr 警告又會在重導向後消失，因此改為 exit `1` 且不寫檔，要求以 `--no-limit` 或 `--limit N` 明確表態。Elasticsearch 匯出的 1000 筆上限同此處理。
- **CLI 錯誤輸出收斂。** 連線類錯誤在所有指令路徑都會被頂層 handler 攔截並格式化，stderr 首行即為人類可讀訊息，不再由 Bun 印出打包後的 code frame 與未解碼的中文跳脫序列。stack 改掛在 `-v` / `-vv` 之下，預設不輸出。

### Fixed

- **MySQL 8 schema introspection 相容預設 `ONLY_FULL_GROUP_BY`。** 外鍵查詢現在完整分組 referenced table，不再讓 `dbcli schema <table>` 在原廠預設設定下失敗。
- **已分類的連線錯誤不再被巢狀 adapter catch 重包。** `mapError` 直接保留既有 `ConnectionError` 的 identity、code、message 與 hints，消除 `Connection failed: Connection failed:` 重複前綴與分類退化。
- **stdout 管線與 Windows CI 修復。** redirected stdout 以完整同步寫入避免 64KB 截斷；測試 filesystem 與換行處理改為跨平台實作，Windows matrix 恢復全綠。
- **發布依賴安全更新。** 將 PostCSS 鎖定至 `8.5.25`、`brace-expansion` 鎖定至 `5.0.9`，清除 release gate 回報的 3 個 high-severity advisories；並統一 Prettier 格式，讓完整 9 階段發布檢查恢復全綠。
- **`--no-limit` 過去被靜默忽略。** Commander 會把 `--no-limit` 折進 `limit` 屬性（設為 `false`）而不會產生 `noLimit`，但 `query` / `q` / `export` 都讀 `options.noLimit`，導致這個旗標自始無效——`query` 仍套用 1000 筆上限，`q` 仍包 size guard。CLI 邊界現在會把 Commander 的否定形式轉回指令實際讀取的形狀。
- **`dbcli export` 的 SQL 路徑忽略 `--limit` 與 `--no-limit`。** 該分支未把選項傳給 QueryExecutor，任何 `--limit N` 都不生效。
- **`-v` / `-vv` 的 stack 開關過去對 `q` / `insert` / `update` / `delete` 無效。** 這四個指令自行輸出在地化訊息、繞過共用的錯誤呈現層，因此 verbose 對它們不會多印任何東西。改為共用同一個呈現函式：措辭維持不變，但 verbose 下會補上 stack。
- **Redis 的 size-guard warning 在 `query` 被丟棄。** adapter 早已算出 `REDIS_SIZE_TRUNCATE` / `REDIS_SIZE_REWRITE` / `REDIS_BLACKLIST_FILTERED`，但 `query` 分支完全沒讀 `result.warnings`——文件卻聲稱結果會帶 `warnings[]`。現在每則 warning 都會印到 stderr，且被裁切的回覆會回報 `truncated` / `limit_applied`，與其他引擎一致。
- **`--query-file -` 在互動式終端會無提示空等。** 改為立即拒絕並說明需要 piped input，與 repo 中其他 stdin 消費端（`insert`、`shell`、`audit`）既有的 TTY 檢查一致。
- **單一連線 (v1) 設定會靜默忽略 `--use` / `DBCLI_CONNECTION`。** v1 沒有具名連線可選，過去卻照樣執行那唯一的連線，讓使用者以為切換成功——正是 issue #7 要避免的情境。現在會明確報錯並指出升級為 v2 的方式。
- **skill assets 與 reference 補齊。** `assets/SKILL.md`、`SKILL.zh-TW.md` 與 `reference.md` 新增查詢工作流程旗標章節；`reference.md` 原本記載「MongoDB 不套用 auto-limit」與實際行為不符，已更正為套用於 filter 與未自帶 `$limit` 的 pipeline。

## [1.42.0] - 2026-07-20 - Drizzle Snapshot 與 ORM DDL 工作流擴充

### Added

- **Drizzle Kit snapshot 可直接用於 ORM drift 比對。** `dbcli diff --against-orm` 新增 Drizzle snapshot 格式偵測與 `NormalizedSchema` adapter，支援 PostgreSQL v7 snapshot 的 table、column、primary key、unique constraint、index 與 foreign key metadata。
- **TypeORM／Sequelize DDL alias。** `--orm-format typeorm`、`typeorm-ddl`、`sequelize` 與 `sequelize-ddl` 可直接走既有 DDL adapter；自動忽略 `typeorm_metadata` 與 `SequelizeMeta` bookkeeping table，並補上 source-file 使用者的可執行匯出／比對指引。

### Changed

- **ORM drift 文件完整同步。** 英文／繁體中文的 Markdown 與 HTML 使用者文件、skill assets、各平台 plugin 副本及 reference 已補上 Drizzle snapshot、TypeORM／Sequelize DDL 的格式、限制與操作範例。
- **跨平台發版 metadata 對齊。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.42.0`。

### Fixed

- **不支援的 ORM 輸入改為 fail closed。** Drizzle snapshot 會拒絕不支援的版本／dialect、generated／identity／enum／composite primary key 等結構，以及無法無損轉換的 column default；TypeORM／Sequelize source file 則回報完整的匯出 DDL recipe，不再被 JSON／DDL fallback 誤解析。
- **Qualified ignore identity 保留完整。** ORM drift 的 ignore 比對不再把 schema-qualified identity 降成 bare table name，避免同名 table 跨 schema 時被錯誤忽略；ORM DDL alias 也會正確沿用 DDL 輸入處理與 bookkeeping ignore。

## [1.41.0] - 2026-07-19 - ORM Drift 比對與無損 Schema Identity

### Added

- **`dbcli diff --against-orm` ORM drift 比對。** 可將 Prisma schema、DDL／migration SQL 或 normalized JSON 與既有 SQL schema cache 比對；支援多檔 DDL、filesystem glob、格式自動偵測、大小寫敏感的 `--ignore` pattern，以及 JSON、table、Markdown 輸出。比對只讀本地 cache，不連線、不更新 cache，也不執行提案。
- **結構化 drift 分類與安全提案。** 報告區分 `missing_in_db`、`missing_in_orm`、`mismatch`、`unmanaged` 與 `unparsed`；只有計分後的 error 會使 drift exit code 為 `1`。可無損表達的缺漏欄位／index 會產生 shell-safe、預設 dry-run 的 `migrate` 提案，其餘情況升級至 `migration-review`。
- **`orm-drift-review` agent task pack。** 工作流依序執行 blacklist 檢查、schema cache 更新與 ORM drift JSON 比對，並要求將 dry-run DDL 與精確目標交給獨立 migration review。

### Changed

- **Schema identity 改為精確保存。** PostgreSQL schema／table 名稱不再正規化為小寫；quoted 與 unquoted identifier 依 SQL 規則解析，qualified name、ignore pattern、foreign key 與 drift output 都保留大小寫與 schema identity。
- **ORM drift 文件完整同步。** 英文／繁體中文的 Markdown 與 HTML 使用者文件、skill assets、各平台 plugin 副本及 reference 已補上格式、exit code、安全邊界與操作流程。
- **跨平台發版 metadata 對齊。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.41.0`。

### Fixed

- **Lossy ORM drift proposal 改為 fail closed。** Schema-qualified target、dash-leading positional、無法無損表達的 index column、identity collision 與不支援語法不再輸出可能損壞的指令，而是阻擋或升級人工審查。
- **DDL／Prisma adapter identity 與語意硬化。** 多檔 DDL 共用 deterministic context，foreign key pairing、default schema resolution、table option／partition 阻擋、重複 index 去重與 Unicode code-point 穩定排序皆保留來源語意。

## [1.40.0] - 2026-07-19 - SQL Lint、安全強化與 Agent 工作流擴充

### Added

- **新增唯讀 `dbcli lint` 靜態 SQL 顧問。** 支援 inline SQL、saved query、SQL 檔案與 glob／混合批次輸入，提供 text、JSON、Markdown 輸出、最低嚴重度篩選、`--no-schema` 與 `--recovery`；指令不連線、不執行 SQL，也不會自動套用 rewrite。
- **九條結構與 schema-aware lint 規則。** 涵蓋 `SELECT *`、未錨定 `LIKE`、深度 `OFFSET`、non-sargable predicate、`OR`／subquery 改寫機會、重複 `DISTINCT` + `GROUP BY`、implicit cast，以及 `NOT IN` 右側 NULL 風險；finding 可附 confidence 標籤的草稿與 shell-safe 驗證指令。
- **MongoDB agent task packs。** 新增 `mongo-safe-backfill` 與 `mongo-schema-drift-review`，補上 MongoDB 安全回填與 schema drift 檢視工作流。

### Changed

- **Slow-query guide 納入 lint。** `guide slow-query` 現在會先安排本機靜態分析，再銜接 explain 與診斷 snippets，brief plan 也保留執行 metadata。
- **Agent 與使用者文件完整同步。** `lint` 已寫入 skill assets、platform plugin 副本及英文／繁體中文 Markdown 與 HTML 文件；GitHub Pages 產品介紹頁同步完成雙語、可及性與行動裝置導覽重構。
- **跨平台發版 metadata 對齊。** npm package、Codex／Claude／Cursor plugin、packaged Codex plugin 與 Gemini extension 統一為 `1.40.0`。

### Fixed

- **Lint 採 fail-closed 安全邊界。** 解析失敗、schema binding 不明、identifier 大小寫碰撞、CTE／derived／qualified relation 與不安全 rewrite proof 會阻擋對應建議，不再借用不可靠的 cache facts。
- **`NOT IN` NULL 分析補齊 scope 與 provenance。** 遞迴處理巢狀 SELECT、CTE、derived statement、JOIN `ON`、`WHERE`、`HAVING`、outer-join null extension、nullable 投影與 CASE／cast／aggregate，並保留正確 traversal order。
- **Lint audit／recovery 遮蔽與驗證指令硬化。** positional、global、bulk 與 `--` 後的 SQL 都會遮蔽；只有結構上已證明唯讀的 SQL 才建議 `explain --analyze`，session assignment 與 function-bearing statement 會保守退回 plain explain。

## [1.39.2] - 2026-07-03 - Windows 跨平台、skill 安裝安全與 plugin 版本對齊

> npm `1.39.1` 已於 2026-06-30 發布；本批修復在其後累積於同一版號下（npm 版本不可覆蓋），故獨立為 1.39.2 以便日後發布。

### Fixed

- **Windows 跨平台修復（Windows CI 首次全綠）。** filesystem 操作與 path 檢查改為跨平台實作、修正 `emit` 子行程 import 與殘留的 path assertion，並以 portable `node:fs` 取代僅限 unix 的 coreutils spawns。此前 Windows job 從未通過（fail-fast 總是先取消它）。
- **Skill 安裝安全強化。** 修正 output / install 旗標衝突、強化安裝安全檢查與 task 過濾條件。
- **zh-TW skill 安裝不再被誤判為永遠過期。**
- **Skill 參考修正。** 移除文件中不存在的 `blacklist add`、補回缺漏的 reference flags。

### Changed

- **文件補齊。** 明示 `--where` 僅支援等值比較、補上 Redis / Elasticsearch 寫入模型說明、記錄 home-storage 綁定並重新同步 md/html parity、對齊 config-location-policy 與實作綁定模型。
- **Plugin manifest 版本對齊。** `.claude-plugin` / `.cursor-plugin` / `.codex-plugin` 及 `plugins/dbcli-agent` 的 `plugin.json` 版本更新為 1.39.2（先前漂移在 1.37.1 / 1.31.0，未跟上主版本；`plugin:sync` / `plugin:check` 只同步 skill 內容不同步版本）。

### Internal

- CI 加入 doc / skill drift guards 並修正 release-gate 說明；新增 `reference.md` 指令覆蓋契約測試；移除失效的 `validate-skill.sh`（testing doc 改指向 `bun test`）；稽核冗餘測試改用 collision-proof token sentinel；zsh 不存在時跳過 rc-eval 測試；每檔還原 leaked spies 以修正順序相依的 CI 失敗；prettier 對齊 `q` / audit `logger` 測試。

## [1.39.1] - 2026-06-30 - Skill report dashboard routing

### Fixed

- **Dashboard 請求不再落入通用 query 路由。** 先前 dashboard / report 意圖的請求會 fall through 到一般 query 路徑；現已正確導向 dashboard 專用流程。

### Changed

- **Skill 路由補上 DB report / dashboard / HTML UI 意圖。** `assets/SKILL.md` / `assets/SKILL.zh-TW.md` 的 metadata、任務路由表、開發者速查與 HTML dashboard 範例現在明確導向 `queries search|suggest` → `queries show` → `q @<name> --ui` / `--format html`，並保留 raw SQL `export --format html` 的檔案輸出路徑。已透過 `plugin:sync` 同步到所有受管理平台副本。純文件 / skill 變更。

## [1.39.0] - 2026-06-24 - Dashboard chart type 解析時邊界驗證

### Changed

- **`--ui` dashboard chart type 改為解析時驗證。** Saved query 的 `visual.charts[].type` 現以單一合法集合 `line` / `bar` / `area` / `pie` 驗證；指定未支援的類型（含打錯字）會在解析時拋出 `SavedQueryError`（`PARSE_ERROR`），訊息列出合法清單。先前的行為是把任何未知類型**靜默畫成圓餅圖**。型別宣告中從未被渲染的 `scatter` 一併移除。

### Fixed

- **未知 chart type 不再靜默偽裝成圓餅圖。** dashboard 渲染端對非可渲染類型顯示明確的「Unsupported chart type」佔位，而非 fallthrough 成 `PieChart`。

## [1.38.1] - 2026-06-23 - Redis delete 能力對齊 & SKILL.md 任務路由重構

### Fixed

- **Redis `delete` 能力宣告由 `unsupported` 修正為 `limited` / `db-write`。** `delete.ts` 早已具備完整的 Redis 刪除分支（`DEL` / `HDEL` / `LREM` / `SREM` / `ZREM`、data-admin 權限閘、`--dry-run`、黑名單、稽核），但 `capabilities.ts` 仍宣告為 `unsupported`，與實作矛盾，導致能力表低報 Redis 刪除支援。改宣告為 `limited`（`db-write`，標註「基本刪除，需 data-admin、支援 `--dry-run`」）以對齊實作。於 SKILL.md 的 src 驗證期間發現。

### Changed

- **`assets/SKILL.md` 重構為任務路由決策樹。** 由原先結構改寫為以任務為導向的決策樹（task-routing decision tree），讓安裝 skill 的 agent 能依任務類型快速定位對應的指令工作流。純文件結構調整，無程式行為更動。

## [1.38.0] - 2026-06-22 - verify constraint Scenario

### Added

- **`dbcli verify constraint` 情境執行器（第四個內建 verify 情境）。** 以 preflight / after-write 兩種模式驗證「資料完整性不變式是否成立」，且**永遠不執行寫入或 DDL** — 只執行唯讀 `COUNT(*)` 違規查詢。以 `--check <kind>` 選擇四種限制類型：`fk`（孤兒列，需 `--column` + `--references <table.column>`）、`not-null`（NULL 值統計，`--column` 可重複）、`unique`（重複值統計，`--column` 可重複）、`custom`（呼叫端自訂的唯讀 `--violation-query <sql>`）。預設 threshold 為 `0`（嚴格：零違規即通過）；啟用 `--allow-preexisting` + `--baseline <n>` 可改為無回退模式（after-write 筆數 ≤ preflight baseline 即通過）。文物沿用 `subject.kind = 'table'`、`subject.command = 'verify constraint'`，artifact schema 與版本不變。MVP 僅限 SQL 引擎，FK 僅支援單一子欄位。

## [1.37.1] - 2026-06-22 - Skill Documentation Parity for verify rollback

### Fixed

- **Skill 文件補上 `verify rollback`。** v1.37.0 出貨的 `dbcli verify rollback` 先前未寫進可安裝的 skill 文件，導致安裝 skill 的 agent 不知道此指令存在。於 `assets/SKILL.md` / `assets/SKILL.zh-TW.md` 加入工作流速覽行，並於 `assets/reference.md` 新增完整 `#### verify rollback` 區段（`--kind ddl|dml`、`--statement`、preflight / after-write 雙範例、MVP 限制與 artifact subject 對應）。透過 `plugin:sync` 將內容傳播到所有受管理的平台副本（`skills/`、`.github/skills/`、`.cursor/`、`.windsurf/`、`plugins/`）。純文件變更，無程式行為更動。

## [1.37.0] - 2026-06-22 - Rollback Scenario & Nested Shell Completions

### Added

- **`dbcli verify rollback` 情境執行器(第三個內建 verify 情境)。** 透過已穩定的 scenario registry 註冊,以 preflight / after-write 兩種模式驗證「還原變更後資料庫是否回到預期的先前狀態」,且**永遠不執行**還原寫入 / DDL——只分析 `--statement` 並執行回讀斷言。以必填的 `--kind <ddl|dml>` 選擇還原語句文法:`ddl` 複用 `migration` 的單語句 `ALTER TABLE` 契約,`dml` 複用 `safe-backfill` 的 `UPDATE` plan 契約。安全邏輯完全複用兩個 sibling 情境的 classifier,無重複實作。artifact 沿用既有 subject kind(`ddl→migration`、`dml→backfill`)並以 `subject.command = 'verify rollback'` 記錄出處,因此 artifact schema 與版本不變。
- **巢狀 bash / zsh / fish shell 補全。** 以遞迴 command-tree metadata model 從指令樹生成巢狀子指令與旗標補全,並由共用 registry 驅動 REPL 的補全與分派;補全會排除 denylisted 指令。

### Changed

- **REPL 補全 / 分派改由共用 registry 驅動。** 補全與指令分派統一從同一份 command registry 取得,降低 CLI 與 REPL 之間補全行為漂移的風險;`buildProgram` 抽成可重用 factory 並消除補全啟動噪音。

## [1.36.0] - 2026-06-22 - Verification Scenario Runner Suite

### Added

- **`dbcli verify safe-backfill` 情境執行器。** 以 preflight / after-write 兩種模式驗證安全回填工作流，並**永遠不執行回填寫入**：preflight 依序跑黑名單、schema、目標表與唯讀 verify-query 防護後回傳 `ready` / `blocked` 並印出精確的 after-write 指令；after-write 重跑防護、執行回讀斷言，並寫入 v1 `VerificationArtifact`（狀態對應 `verified` / `not_verified` / `indeterminate`，防護失敗為 `blocked`）。
- **`dbcli verify migration` 情境執行器。** 對 schema migration 做 preflight / after-write 驗證，且**永遠不執行 DDL**：分析提案的 `ALTER TABLE`、跑唯讀防護、要求 DDL 目標與 `--table` 相符（schema-aware），after-write 後記錄 `migration` 主體的證據。MVP 僅接受單語句 `ALTER TABLE`，並阻擋 `CREATE TABLE` / `DROP TABLE` / `CREATE INDEX` 及多語句 DDL。
- **`ALTER TABLE` 目標識別字契約。** `verify migration` 的目標擷取改用 quote-aware tokenizer：支援 `table` / `schema.table` / `catalog.schema.table`，每區段可為未加引號名稱或雙引號 / 反引號 / 方括號識別字（含 `""`、`]]` 跳脫），因此 `"user accounts"`、`"tenant-1"."orders"` 等含空白或連字號的名稱皆可接受。無法完整解析的目標（未封閉引號、不支援的跳脫、超過三段）會 fail closed 並以「目標無法解析」為由阻擋，與 `must match --table` 的不符原因明確區分。
- **`verification summary --latest-only` 交接選項。** 於既有 summary 輸出之上額外回傳最新一筆有效 artifact，方便 agent 在交接時直接引用最新證據；無 artifact 時回傳 `latest: null` 並維持 exit 0，無效檔案不會被升入 `latest`。

### Changed

- **抽取共用情境原語至 `src/core/verify/scenario.ts`。** 防護排序、all-guards-passed 判定、有界原因、狀態對應、shell-quote 與證據遮蔽等共用邏輯集中於此，`safe-backfill` 重構為消費這些原語且**對外行為零變更**，降低後續情境的重複實作風險。

## [1.35.0] - 2026-06-19 - Verification Inspect & Prune Surface

### Added

- **`dbcli assert --write-verification-artifact` 橋接（opt-in）。** `assert` 的判定結果（verdict）現在可選擇性地寫成一份結果型 `VerificationArtifact`：透過 subject 解析器將斷言主體對應到 artifact 的 `subject`、依 pass/fail 對應驗證狀態，並以既有的原子寫入器落地於 `.dbcli/verification/`。省略旗標時行為完全不變、不寫入任何檔案；`safe-backfill-verify` 仍維持 plan-only。artifact 路徑一律相對於 cwd，與 `--config` 無關。
- **唯讀 `verification` 指令介面（inspect + 生命週期）。** 新增核心 artifact 讀取器（含 schema 驗證、filter / summarize / find 輔助函式），並以此建構出 `verification list`（表格輸出，支援 subject-kind 篩選）、`verification show`、`verification summary` 等唯讀檢視指令，讓 agent 能直接讀取與彙整既有驗證證據，而非自行解析檔案。
- **`verification prune` 保留期清理。** 依保留期（duration 解析）與全域 `--keep-latest` 規則挑選清理候選，全域 keep-latest 優先於各項篩選；具刪除安全防護（缺少 mtime 的檔案排除在外、預設 dry-run 預覽、`--execute` 才實際刪除），並在 execute 模式輸出 deleted / skipped 明細表。
- **完整 v1 證據驗證。** 對 `subject` / `evidence` / 選用欄位進行完整驗證，並加入執行期 evidence-kind 防護，確保讀取與寫入兩端對 schema v1 的解讀一致。

## [1.34.0] - 2026-06-18 - Verification Artifact Writer

### Added

- **驗證證據建構器（`buildVerificationArtifact`）。** 純函式，產生 schema v1 的 `VerificationArtifact`：可注入 `now` / `idFactory` 以利測試確定性、證據文字欄位上限 2000 字元（超過截斷並標註）、證據筆數上限 20（超過保留前 19 筆並補一筆 `manual` 截斷標記）；拒絕非法狀態、空白 summary、空證據。集中化證據裁切,讓後續寫入器與指令介面不必各自重複截斷決策。
- **`safe-backfill-verify` 計畫的「已規劃」驗證中繼資料。** `dbcli skill tasks plan safe-backfill-verify --format json` 現在輸出一個 `verification` 區塊（`status: "planned"`,取計畫中最後一個 `assert` 步驟作為證據)。此為**已規劃**證據,**不代表**驗證已執行或通過,與結果型 `VerificationArtifact` 明確區隔。其他 task pack 不受影響。
- **驗證證據寫入器（`writeVerificationArtifact`）。** 將建構出的 artifact 以原子方式寫入 `.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json`：檔名完全由 artifact 內部產生（UTC 時間戳 + `[a-z0-9]` 淨化短 id,杜絕路徑穿越)、缺少目錄時自動建立、以 `link()` 獨佔建立確保不會靜默覆寫既有檔案、回傳寫入路徑。
- **`recover --apply --write-verification-artifact`（opt-in)。** 僅在 verify 步驟實際執行時,將 recovery 驗證結果寫成一份 `recovery-verify` artifact（狀態取合約 `verificationStatus`,附 `recoveryRef`)。省略旗標時行為完全不變、不寫入任何檔案;寫入失敗只記到 stderr,不影響結束碼。保留既有 `verifyStatus`、不嵌入任何指令輸出或機密。

## [1.33.0] - 2026-06-18 - Workflow Pack Expansion

### Added

- **4 個新的 plan-only Agent Task Pack（皆唯讀)。** `pr-database-review`（PR 變更持久化路徑、查詢、migration 的資料庫風險審查)、`migration-review`（在套用 DDL 前擷取變更前 schema 證據並預覽 migration)、`safe-backfill-verify`（規劃安全 backfill 並產生 read-back `assert` 驗證指令)、`slow-endpoint-investigation`（串接 proxy / explain / missing-index 證據調查慢端點)。每個 pack 都以 `safety.mode: plan-only`、`risk: readonly` 步驟組成,只產生計畫、永不寫入;SQL 類 pack 先支援 `postgres` 與 `mysql`。
- **Skill 路由更新（en / zh-TW)。** 在 `SKILL.md` 與 `SKILL.zh-TW.md` 的 Agent Task Packs 段落各加入一段精簡導引,讓 agent 在自行組合手動的審查、migration、backfill、效能流程前,先選擇對應的 workflow pack;已重新同步所有 plugin / platform skill 副本。

## [1.32.0] - 2026-06-18 - Agent Task Packs Expansion & Skill Parity Guards

### Added

- **4 個新的內建 Agent Task Pack（皆 `plan-only` 唯讀）。** `audit-permissions`（權限等級與 blacklist 覆蓋稽核）、`safe-backfill`（在寫入前做 blacklist + schema + 風險檢查的回填計畫）、`schema-drift-review`（快取/committed schema 與線上 schema 的漂移比對）、`connection-health`（連線可達性 / 設定 / 容量分級三步診斷）。皆走確定存在的唯讀指令;用 `dbcli skill tasks list` 瀏覽完整清單。
- **平台清單 parity 檢查（`scripts/check-platform-parity.ts`，`bun run platform:check`）。** 以 `SUPPORTED_PLATFORMS` 為單一真實來源，驗證 README、SKILL.md、SKILL.zh-TW.md、reference.md 與 CLI `--install` 選項描述的平台列舉完全一致（缺項或多項皆報錯），並掛進 `release-check.sh`。
- **語意 parity 守門。** `scripts/check-skill-parity.ts` 在結構比對外，新增 14 個語言不變的安全/命令 token（`query`/`insert`/`update`/`delete`/`export`/`schema`、`blacklist`、`--dry-run`/`--no-limit`/`--recovery`、`LIMIT 1000`、三個權限等級）在 EN 與 zh-TW 皆須對稱出現的檢查。
- **安裝與 context CLI 測試覆蓋。** 新增 `skill --install` 對 7 個平台寫入 temp HOME/cwd 的 smoke 測試（含 cursor/windsurf 的 root-rule + reference 雙檔結構），以及 `skill context` 的 xml/json/markdown、預設格式、無效格式與 blacklist 不外洩的 CLI 入口測試。

### Fixed

- **`codex` / `windsurf` 安裝目標文件漂移。** 兩者已存在於 `SUPPORTED_PLATFORMS`（`--install` 實際可用），卻在 `SKILL.md` / `SKILL.zh-TW.md` 缺漏、`windsurf` 在 README 缺漏。已補齊並重新同步所有 plugin/skill 副本;新的 `platform:check` 會防止再次漂移。

## [1.31.0] - 2026-06-10 - Data Editing Surface & Agent Plugin Packaging

### Added

- **`@carllee1983/dbcli/core` 公開匯出 `DataExecutor` 與資料執行型別。** 在 `./core` barrel 開出資料編輯介面（insert/update/delete 執行面），讓外部消費者（如 `dbcli-gui` sidecar）能重用與 CLI 同源的資料寫入能力，不必重寫 adapter 邏輯。CLI 行為不變。
- **Agent plugin 打包與 marketplace 安裝。** 將 dbcli 打包為 agent plugin（Ponytail 風格 marketplace install），新增 GitHub Copilot CLI plugin 支援與 Cursor plugin 安裝（add-plugin metadata、marketplace 提交路徑），並依各 agent 拆分安裝指令與文件。
- **開發者工作流 skill 指引（en/zh-TW）。** 在 dbcli skill 新增「Developer workflows」段落，把資料庫影響隱含於開發任務時的最小安全路徑（DB-backed 功能、資料錯誤排查、ORM/migration、PR 審查、慢查詢、回填、環境驗證）寫入 SKILL en/zh-TW 與各平台副本，並以可執行的指令錨點取代不可執行的 migrate 範例。

## [1.30.0] - 2026-06-09 - Connection Writer API

### Added

- **`@carllee1983/dbcli/core` 新增連線寫入 API。** 在 `./core` barrel 公開純函式 mutation：`upsertConnection`、`removeConnection`（含預設連線重指派與 last-connection 防護）、`setDefaultConnection`、`migrateV1ToV2`（保留 legacy `.env.local` 密碼）、`writeConnectionSecret` + `envVarNameFor`（per-connection env 命名空間）。讓外部消費者（如 `dbcli-gui` sidecar）能程式化管理 `.dbcli` v2 連線，與 CLI 同源。CLI 行為不變。

### Fixed

- **`writeV2Config` 改為 atomic temp+rename 寫入**，避免寫入中斷時破壞設定庫。
- **`migrateV1ToV2` 對非 SQL 的 v1 連線 fail-loud 拒絕**，防止把不相容連線寫進 v2 設定庫。

## [1.29.0] - 2026-06-08 - Core Config-Read Entrypoint

### Added

- **`@carllee1983/dbcli/core` 新增設定載入入口。** 在 `./core` 子路徑公開 `readConfig(path, connectionName?)`（binding-aware、v1/v2、`{$env}` 展開的統一設定讀取，與 CLI 指令同源）、`resolveConfigStoragePath(path)`（project-binding 解參）與型別 `DbcliConfigV2`、`SqlConnectionOptions`／`QueryableConnectionOptions`（SQL adapter 連線型別收窄）。讓外部消費者（如 `dbcli-gui` sidecar）能從 `.dbcli` 專案路徑解出含真實連線資訊的 `DbcliConfig`，不必重寫內部 binding／env 邏輯。CLI 行為不變。

## [1.28.0] - 2026-06-08 - Core Subpath Export

### Added

- **`@carllee1983/dbcli/core` 子路徑匯出。** 新增穩定對外 API barrel（`src/core/public.ts`），透過 `package.json` 的 `exports` map 開出 `./core` 子路徑，並隨套件發布 `dist/core.mjs` 與扁平型別宣告 `dist/core.d.ts`。外部專案（如 `dbcli-gui` 桌面客戶端的 Bun sidecar）可 `import { AdapterFactory, QueryExecutor, SchemaLayeredLoader, listConnections, BlacklistManager } from '@carllee1983/dbcli/core'` 直接重用引擎能力。CLI（`bin`）行為完全不變。

## [1.27.0] - 2026-06-05 - Proxy Analyze

### Added

- **`dbcli proxy analyze` — 離線分析 proxy 事件日誌。** 讀取 `.dbcli/proxy/events.jsonl`(預設含 rotation `.1` 段),聚合成 agent-facing JSON 報告(`summary`、`byFingerprint`、`slowest`、`errors`、`hotTables`、`repetition`)或人類版 text。重用 `redactLiterals` 做 SQL 指紋正規化;對最吃總時間的 SELECT 指紋附上可執行的 `suggestedCommands`(`explain` / `guide missing-index-for`),僅輸出建議指令字串、不自動執行。旗標:`--events`、`--format json|text`、`--top`、`--slow-ms`、`--n-plus-one`、`--no-include-rotated`。不連資料庫。

### Changed

- **`dbcli proxy` — 事件日誌寫入序列化 + 自動輪替。** `EventWriter` 現在將所有寫入(根事件 + 全部 session)序列化到單一 in-process promise 鏈,避免多連線併發時 JSONL 行交錯或 rotation 計數競態;單一寫入失敗只影響該呼叫端(維持 fail-loud),不會卡住後續寫入。新增自動輪替(重用抽出的中性工具 `src/utils/jsonl-rotation.ts`,audit logger 亦改用同一份):當下一行將達 ~50 MiB 或 200,000 筆時,目前檔案改名為 `<events>.1`(覆寫舊段),保留單一滾動段,最壞磁碟用量約為位元組上限的 2 倍。先前 `events.jsonl` 會無限制成長。

### Fixed

- **`dbcli proxy` — `--slow-ms` 現在會在事件中標記 `slow`。** `query_completed` 事件新增 `slow: boolean` 欄位（`durationMs >= --slow-ms` 時為 `true`），與既有的終端警告一致。先前 `--slow-ms` 僅印出終端警告，但 CHANGELOG／使用者文件／reference 卻宣稱事件帶有 `slow` 旗標——此落差已修正。同步修正 `reference.md` 的 JSONL 事件範例(欄位名與實際 `query_completed` 結構對齊)，並更新 en／zh-TW 使用者文件(md + html)中對 `--slow-ms` 的描述。

## [1.26.0] - 2026-06-04 - Observability Proxy

### Added

- **`dbcli proxy` — 本地端開發觀測代理。** 支援 `mysql`、`mariadb`、`postgresql` 子指令。在現有應用程式與真實資料庫之間插入一個中繼層:dbcli 監聽 `--listen` 埠,轉送流量至 `--target`(或 `--use` / config 目標推斷),並把每個查詢的查詢文字、延遲、傳輸位元組、錯誤等事件以 JSONL 格式附加到 `.dbcli/proxy/events.jsonl`(可用 `--events` 覆寫)。僅作觀測使用,不執行任何改寫或封鎖。旗標:`--listen <addr:port>`、`--target <addr:port>`、`--events <path>`(預設 `.dbcli/proxy/events.jsonl`)、`--slow-ms <ms>`(預設 `1000`,超過即在事件中標記 `slow: true`)、`--redact none|literals`(預設 `none`;`literals` 會從事件裡剔除 SQL 字面值)、`--format text|json`(預設 `text`)。TLS 在 v1 僅轉送不解密;prepared / extended 協定為盡力標記。

## [1.25.0] - 2026-05-29 - Data-Layer Verification

### Added

- **`dbcli snapshot <query>` — 結果指紋。** 將任一查詢結果轉成確定性、黑名單安全的 `ResultSnapshot`(`rowCount` + 每欄聚合:null/distinct 計數、min/max/sum、順序無關的 checksum)。預設落檔至 `.dbcli/snapshots/snap-<timestamp>.json`,亦支援 `--out`、`--stdout`、`--rows`(連同遮罩後的列一併存檔)、`--format`、`--no-limit`。
- **`dbcli assert <query>` — 行內不變量檢查。** 三種模式:`--expect`(`rows > 0`、`value == 5000`、`col:email not null`、`col:id unique`、`col:amount between 0 and 100`、`col:age >= 18`)、`--vs <query> --compare rows|value`(跨查詢對帳)、`--against <snapshot> --tolerance <pct>`(對既有快照基準比對)。預設失敗時 `exit 1`,可用 `--no-fail` 僅報告不改變 exit code。
- 兩個指令均沿用既有 adapter / QueryExecutor / blacklist / audit 堆疊,黑名單欄位由 QueryExecutor 在源頭遮罩,指紋天生安全。目前支援 SQL 引擎(PostgreSQL / MySQL / MariaDB)。

## [1.24.0] - 2026-05-29 - Antigravity CLI Skill Target

### Added

- **`dbcli skill --install antigravity` 新增 Antigravity CLI 安裝目標。** Antigravity CLI 是 Google Gemini CLI 的後繼者;skill 會寫入 CLI 範疇的全域路徑 `~/.gemini/antigravity-cli/skills/dbcli/SKILL.md`(同目錄附帶 `reference.md`)。`SUPPORTED_PLATFORMS` 一併納入 `antigravity`,故 `dbcli upgrade` 的 skill 過期檢查也會涵蓋此平台。

### Changed

- `gemini`(Gemini CLI)安裝目標暫予保留,但已標示為即將淘汰,建議改用 `antigravity`。README(en/zh-TW)、`assets/SKILL.md`、`assets/SKILL.zh-TW.md`、`assets/reference.md` 與 `docs/user` 的平台清單同步更新。

## [1.23.1] - 2026-05-29 - Skill Docs Sync

### Changed

- 補齊 `assets/SKILL.md` 與 `assets/reference.md`,涵蓋 v1.22(Redis `redis.mask` 遮罩、Elasticsearch export/shell)與 v1.23(`explain`、`guide missing-index-for`、`inspect` 情境感知 `suggestedCommands` + `hints`、內建 task pack `analyze-table-perf`)的指令與旗標說明,使 `dbcli skill --install` 產出的文件與實際行為一致

## [1.23.0] - 2026-05-29 - Source-Driven Performance Review Tooling

### Added

- **`dbcli explain` 一級指令。** 把 `EXPLAIN` / `ANALYZE SELECT` / `EXPLAIN (ANALYZE, BUFFERS) SELECT` 包成統一介面,單條 query、`@saved-query`、`@file.sql`、`@glob/*` 通吃。輸出統一的 `ExplainRow` schema,附 5 條 actionable annotations(`full-scan` / `temp-table` / `filesort` / `cost-estimate-skew` / `nested-loop-large`)。輸出格式 markdown(預設)/ json / table。支援 `--bulk` 多筆批次。MariaDB + MySQL + PostgreSQL。(v1.23 P2)
- **`dbcli guide missing-index-for` 單條 query 複合索引顧問。** 解析一條 `SELECT`,結合真實 `EXPLAIN` 計畫與既有索引,輸出帶 `confidence`(high/medium/low)與 `reason` 的索引候選;偵測既有索引碰撞(single-col 可擴成 composite),並把函式/運算式欄位與無法解析的 SQL 列為 `warnings`。輸出格式 yaml(預設)/ json / markdown,支援 `--min-confidence` 過濾。唯讀(僅 EXPLAIN + 索引內省)。(v1.23 P3)
- **`dbcli inspect` 情境感知 `suggestedCommands` 與新的 `hints` 欄位。** `suggestedCommands` 改為三層加權(bootstrap / context-aware / discovery):collector 讀近 10 條 audit 找出最熱門資料表,有 task pack 時自動建議 `skill tasks plan analyze-table-perf --param table=<table>` 與 `skill tasks list`。新增與 `suggestedCommands` 平行的 `hints` 欄位(JSON 機器可讀 + markdown `## Hints`),提示最熱門資料表、可用 task pack 數量與 schema 快取概況。新增內建 task pack `analyze-table-perf`(唯讀 `plan-only`,吃必填 `table` 參數)。audit 讀取唯讀且永不 throw。(v1.23 P4)

### Fixed

- query-only 模式不再對 `SHOW`/`DESCRIBE`/`EXPLAIN`/`ANALYZE SELECT` 注入 `LIMIT`,避免 server 拒絕(v1.23 P1, issue #1)
- MariaDB `ANALYZE SELECT` 與 PostgreSQL `EXPLAIN (ANALYZE, BUFFERS) SELECT` 視為 read-only,query-only 模式可執行(v1.23 P1, issue #2)
- driver 在 execute 階段丟出的 SQL 錯誤(語法錯、table 不存在、column 不存在)不再被誤包成 `Connection failed`;訊息附 actionable hints 與 fuzzy table 候選(v1.23 P1, issue #3)
- `dbcli schema --refresh` 首次 bootstrap 不再要求 `--force`(v1.23 P1, issue #7)
- query-only 模式拒絕未知 SQL 時的訊息明確化:加入當前 permission level 與 issue 連結

### Changed

- `ConnectionError.code` union 新增 `SQL_SYNTAX_ERROR` / `TABLE_NOT_FOUND` / `COLUMN_NOT_FOUND`(向後相容;既有 consumer 只匹配 `UNKNOWN` 仍 fallback)

## [1.22.0] - 2026-05-21 - Elasticsearch Shell/Export + Redis Masking

### Added

- **Elasticsearch interactive shell.** `dbcli shell` 對 ES 連線開啟 Kibana Dev Tools 風格 REPL:輸入請求行 `<METHOD> /<path>` 加上可選的多行 JSON body,以空白行送出整個區塊,回應以美化 JSON 呈現。以讀取為主 — index 層級黑名單於前端直接拒絕受保護 index;`_search` 若 body 未指定 `size` 自動上限 1000 筆。(P1)
- **Elasticsearch export.** `dbcli export` 對 ES 連線支援兩種形式:傳入 search DSL 並以 `--index` 指定索引以匯出命中結果,或直接以 index 名稱當作查詢、透過 `match_all` + scroll 匯出整個索引。輸出 JSON / JSONL / CSV,預設上限 1000 筆(`--no-limit` 匯出全索引,以 scroll 分批串流)。匯出前套用索引層級黑名單檢查,並寫入稽核紀錄。(P2)
- **Redis value / hash-field 遮罩。** 新增 `.dbcli` `redis.mask` 設定區塊:key 命中 `keyPattern` glob 者,其值(或指定的 hash `fields`)於讀取時(`GET`、`GETRANGE`、`HGETALL`、`HGET`、`HMGET`、`HVALS`)回傳 `[REDACTED]`。遮罩與既有 key-glob 拒絕黑名單並存,且**拒絕一律優先於遮罩**。(P3)

### Fixed

- **Redis shell 單行指令路由。** 在 `dbcli shell` 對 Redis 連線輸入不帶結尾 `;` 的單行指令(`GET mykey`、`SCAN 0`、`HGETALL h`)現可正確執行,修正先前被誤判為未知 dbcli 指令的路由瑕疵。SQL 的分號 / 多行語意不變。(P4)

### Changed

- `src/adapters/capabilities.ts`:ES `export` 由 unsupported 改為 limited(readonly);Redis `blacklist` note 補上 value/hash-field 遮罩;Redis `shell` 單行說明修正。

### Docs

- 雙語 user docs(`docs/user/en` / `docs/user/zh-TW`,md + html)新增 ES shell、ES export、Redis 遮罩段落;`docs/feature-matrix.md` 同步 ES export 與 Redis blacklist 儲存格。

## [1.21.0] - 2026-05-20 - Redis-Parity Pack

### Added

- **Redis shell.** `dbcli shell` 現對 Redis 連線開啟互動式 REPL,具備歷史、readline、tab 補全(指令 + key 前綴)與 `.no-limit on/off` meta 指令。單行語意。
- **Redis size guard.** `SCAN` / `HSCAN` / `SSCAN` / `ZSCAN` 在缺少時補上 `COUNT 1000`;`LRANGE` / `ZRANGE` / `ZREVRANGE` 夾限 `stop`;`ZRANGEBYSCORE` 補上 `LIMIT 0 1000`。`HGETALL` / `HKEYS` / `HVALS` / `SMEMBERS` / `KEYS` 的無上限回覆在 client 端截斷至 1000 並帶 `REDIS_SIZE_TRUNCATE` 警告。`--no-limit` 略過所有防護。
- **Redis blacklist 強制。** `dbcli blacklist add 'pattern'` 現會封鎖 key 命中的 Redis 讀寫。採 Redis 原生 glob(`*`、`?`、`[abc]`、`[a-z]`)。與黑名單重疊的 `KEYS` / `SCAN MATCH` 會被拒絕;未重疊的掃描則濾掉黑名單 keys 並帶 `REDIS_BLACKLIST_FILTERED` 警告。稽核記錄含 `metadata.rejection_reason: 'blacklist'` 與 `matched_pattern`。

### Changed

- `ExecutionResult.warnings` 現為公開型別的一部分(optional),目前僅由 Redis 發出。
- `src/adapters/capabilities.ts` Redis row 更新:`shell` → `interactive`、`query auto-limit` → `limited`、`blacklist` → `limited`。

### Out of scope

- Elasticsearch shell、Redis/ES export、Redis value/hash-field 遮罩 — 延後至 v1.22 或之後。

## [1.20.2] - 2026-05-19

### Added

- **MongoDB MVP 全套支援。** `q` 指令現以 limited-supported 等級納入 MongoDB（`find` / `aggregate` 兩種 snippet body），路由經過專屬分支與 field-masker；`schema` 採 `$sample` + 遞迴 path 偵測（含 BSON 型別），新增 `--sample-method` 旗標；`query` / `export` 套用 `maskMongoRows` 對巢狀結構遞迴遮罩。
- **MongoDB blacklist 強化。** 新增 path-matcher（exact / dotted / suffix-wildcard）、field-masker 遞迴遮罩、insert / update 在寫入前強制套用 nested-path blacklist；`blacklist list` 對 collection 上的 middle-`*` pattern 發出警告。
- **MongoDB 安全模型升級。** update operator 從硬性 allowlist 改為分級安全（tiered operator safety）；schema 對 blacklist 欄位直接 redact；`cache` / `doctor` 暴露 `sampleMethod`。
- **MongoDB snippets 一級公民化。** 內建 reference snippets（find + aggregate）、`queries list/search/suggest` 將 MongoDB snippets 與 SQL 引擎並列；`mongoStrategy` 驗證 body 與 params 並支援 map 形式插值。
- **Recovery — per-code branching for connection codes (MVP)。** `recover --next` 對 connection 類錯誤碼支援多 branch 派發：新增 `buildConnectionBranches` factory（4 個 connection branch）、`matchConnectionBranch` resolver、`classify` emit `branches` / `branchFork`，並提供 `--branch <id>` 旗標讓 agent 顯式選擇 branch。輸出 `NextResult.branchId` 與 markdown 中的 branchId/description 一併呈現。

### Changed

- **MongoDB `q` 文件升級。** `docs/feature-matrix.md` / 雙語 user docs 將 MongoDB `q` 從 unsupported 改為 limited supported（記載目前支援的 body 形式與限制）。
- **Recovery schema 新增 `branches` / `branchFork`。** 行為向下相容（無 branch 時與舊版一致）；`GuideStep` / `NextResult` / `NextStepOutput` 全鏈打通 `branchId`；`shellQuote` 抽離為共用模組。

### Security

- **Pin `brace-expansion ^5.0.6`** 修補 GHSA-jxxr-4gwj-5jf2 ReDoS。

### Tests

- `tests/integration/` — MongoDB tier、blacklist、sampling、snippet 整合覆蓋。
- 新增 mongo plan + schema envelope shape 的 contract test。
- Recovery: doctor↔resolver keyword coupling contract test、connection envelope 6 變體 snapshot、`recover` E2E branching（fork / walk / fallback / `--apply` 不變）覆蓋。

### Docs

- 雙語 user docs 新增 Agent 修復工作流段落（精簡 walkthrough）與 Recovery Cookbook。
- `assets/SKILL.md` / `assets/reference.md` 補 `--branch` 旗標與 `NextResult.branchId` 說明、MongoDB tier / operator / blacklist / sampling 行為。
- 統一 npm 套件名為 `@carllee1983/dbcli`；關閉 v1.20.0 Phase 23-04 已知限制段落。
- `.planning/PROJECT.md` 同步：`bun test`、已 ship 項目移出 OOS。

### Internal

- `style: [recovery] format with prettier (printWidth 100)` / `style: [mongo] format with prettier (printWidth 100)` — 全面套用 prettier `printWidth 100`。
- `fix: [test] remove this alias in mongo sampling mock` — 修正 eslint `no-this-alias`。
- `refactor: [snippets] register mongo as a first-class engine family` / `refactor: [recovery] extract shellQuote to a shared module`。

## [1.20.1] - 2026-05-18

### Changed

- **Phase 23-04 follow-up closure — full DML/DDL audit coverage.** `insert / update / delete / export / q / schema` now invoke `writeAuditEntry` on every happy / failure / rejection branch (BlacklistError / PermissionError / ConnectionError / validation all flow through the wired catch block). This closes the v1.20.0 INTEGRATE-01 / INTEGRATE-04 partial gap noted in v1.20.0's Known limitation paragraph.
- **Bi-directional `audit_ref` ⇄ `recovery_ref` linkage on every `--recovery`-capable command.** When any of the 6 newly-wired commands fails with `--recovery`, the audit entry's `recovery_ref` and the recovery envelope's `audit_ref` carry matching UUIDs — identical in shape to the Phase 25 `query` / `inspect` round-trip wiring. Agents can pivot from `.dbcli/last-recovery.json` to the audit entry via `dbcli audit tail --recovery-ref <id>`.
- **AI-agent skill docs (`assets/SKILL.md`, `assets/SKILL.zh-TW.md`, `assets/reference.md`)** updated to advertise full 8-command bi-directional coverage; bilingual user docs (`docs/user/en/index.{md,html}`, `docs/user/zh-TW/index.{md,html}`) gained a `--recovery` row noting the cross-command linkage.

### Tests

- `tests/integration/recovery-audit-link.test.ts` — the legacy "J1 asymmetry guard" `describe` block (which asserted `'audit_ref' in envelope === false` for the 6 deferred commands) is replaced with a consolidated **6-command positive bi-directional round-trip** block. For each of `schema / q / export / insert / update / delete`, the test asserts `envelope.audit_ref === audit.id` AND `audit.recovery_ref === envelope.id`, with both refs matching `/^[0-9a-f-]{36}$/`.

### Internal

- `src/commands/{insert,update,delete,export,q,schema}.ts` — adopt the D-J catch-block template from Phase 25: pre-generate `envelopeId = crypto.randomUUID()` only when `options.recovery === true`, call `writeAuditEntry({ success: false, error, recovery_ref: envelopeId })` and capture the returned `auditId`, then call `emitRecoveryEnvelope(err, ctx, { envelopeId, auditRef: auditId ?? undefined })`. Success branches add `await writeAuditEntry(config, '<cmd>', options, { success: true, ... })`.
- `src/commands/q.ts` — `handleQError` refactored to accept `config` so audit + envelope can be written together inside the same try/catch.
- `src/adapters/capabilities.ts` — narrow `ExportOptions` / `QCommandOptions` shapes opened so the shared audit helper can read `--recovery` and `--config` without per-command type casts.
- `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md` — coverage table refreshed; all 6 previously-deferred rows flipped to `YES (Phase 23-04 wired)`; Round-Trip Contract section replaces the old Asymmetry Guard section.

## [1.20.0] - 2026-05-17

### Added

- **Agent-facing Audit Log**: every db-touching command writes a structured JSONL entry to `.dbcli/audit/<connection>.jsonl`. Entry shape locked as a contract test (`tests/integration/audit-contract.test.ts`) covering `ts` / `session_id` / `engine` / `command` / `side_effect_tier` / `target` / `success` / `recovery_ref` / `redacted_sql`. Redaction sourced from `tests/helpers/sensitive-output.ts` (single source of truth).
- `dbcli audit tail` / `audit show` / `audit clear` / `audit health` subcommands with `--n`, `--all`, `--for-agent`, `--brief`, `--recovery-ref <id>`, `--format table|json`, `--yes` flags. JSON output is a flat array suitable for agent direct consumption (CLI-01..06).
- `dbcli audit tail --all` cross-connection merged view; `audit show --recovery-ref <id>` bi-directional lookup; `audit health` reports writer state, lock state, rotation cap usage.
- Recovery envelope bi-directional linkage: audit entry `recovery_ref` points at `.dbcli/last-recovery.json`; envelope's new `audit_ref` points back at the audit entry id.
- `inspect` / `guide` / `recover` / `recover --apply` `--for-agent` JSON output embeds `audit_recent: AuditEntryBrief[]` (last 5 entries) for immediate cross-session context.
- `dbcli skill --install <platform> --lang en|zh-TW` (default `en`) to install Traditional Chinese SKILL.md content on agent platforms; target filename remains `SKILL.md` regardless of source.
- New `assets/SKILL.zh-TW.md` — full Traditional Chinese translation of `assets/SKILL.md`, including the new `## Audit Log 使用` section.
- New `## Audit Log usage` section in `assets/SKILL.md` (session handoff + forensics scenarios).
- New `### audit` subcommand block in `assets/reference.md` documenting all 4 subcommands with flag tables.
- `docs/feature-matrix.md` gains an `audit` row (engine-independent, N/A across all 6 engines) and the Side-effect tiers table examples now include `audit tail` / `audit show` / `audit health` (`readonly`) and `audit clear` (`local-write`).
- `scripts/release-check.sh` step `8/8 doc-presence` — release-blocking shell-grep check that the feature-matrix `audit` row and the matching `CHANGELOG.md ## [<version>]` heading both exist.

### Changed

- **Default-on, upgrade impact:** `audit.enabled = true` by default. Existing projects will begin creating `.dbcli/audit/<connection>.jsonl` on first command after upgrading. Set `audit.enabled = false` in `.dbcli` to opt out. The audit directory is gitignored by default; entries are metadata-only (D3) — never raw SQL bodies, `--param` values, or result cell contents. (D1)
- `inspect` / `guide` / `recover` / `recover --apply` agent JSON output adds an `audit_recent` field (additive; shape stable; not a breaking change). v1.19.x consumers ignore the field.
- _Known limitation (Phase 23-04 follow-up):_ Audit log captures `query`, `inspect`, and diagnostic-surface commands in v1.20.0; coverage for `insert / update / delete / export / q / schema` failure paths is tracked as Phase 23-04 follow-up (see `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`). Recovery envelope linkage from the envelope side is unaffected — those commands continue to emit `.dbcli/last-recovery.json` envelopes; only the `audit_ref` back-pointer is missing in v1.20.0. (Closed in v1.20.1 — see entry above.)

### Internal

- New modules under `src/core/audit/`: `logger.ts`, `lock.ts`, `rotation.ts`, `reader.ts`, `recent.ts`, `session-id.ts`, `types.ts`, `integration-helper.ts`.
- New contract / integration tests: `tests/integration/audit-contract.test.ts`, `tests/integration/audit-envelope.test.ts`, `tests/integration/recovery-audit-link.test.ts` (J1 asymmetry guard).
- `scripts/release-check.sh` is now 8 steps (was 7); CONTRIBUTING.md §Release Process and `docs/feature-matrix.md` §Required CI validation block updated to match.
- `src/commands/skill.ts` adds a `resolveSkillSource(lang)` selector and `--lang en|zh-TW` commander option via `new Option(...).choices(['en','zh-TW']).default('en')`. `getInstallPath()` is unchanged (target filename stays `SKILL.md`).

## [1.19.1] - 2026-05-14

### Changed

- Stabilized agent-facing command contracts after v1.19.0 with typed engine capability boundaries and safer guide/inspect/report/recovery JSON shapes.
- Kept generated UI assets deterministic by pinning the UI bundle build to production mode and preserving release formatting gates.
- Refactored the HTML dashboard React template to extract pure formatting, KPI, and table-column helpers for easier unit coverage.

### Fixed

- Aligned adapter creation and command capability checks with the documented feature matrix to avoid unsupported engine paths leaking into agent guidance.
- Tightened saved recovery command redaction and strict envelope validation so recovery artifacts do not expose raw SQL or sensitive flag values.
- Ensured UI report output and browser-opening paths remain covered by smoke tests without shipping stale bundled assets.

### Tests

- Added contract tests for inspect, report, guide, recovery envelopes, engine capabilities, and sensitive-output redaction.
- Added UI helper unit tests and React render smoke coverage for dashboard payload rendering.

## [1.19.0] - 2026-05-11

### Added

- **Expanded Antigravity Protocol**: Added Phase 0 (Scout) for research and Phase 3 (Auditor) for validation to the core agentic workflow.
- **Enhanced Agent Support**: `dbcli skill --install` now supports **Codex (OMX)** and **Windsurf**.
- **Cursor Rules Update**: `dbcli skill --install cursor` now uses the modern `.cursor/rules/*.mdc` project-local format.
- New `GEMINI.md` project-level instruction file with full Antigravity lifecycle guidance.

## [1.18.0] - 2026-05-11

### Added

- **Interactive HTML Dashboards**: `query`, `q`, and `export` can now render results as fully interactive, standalone HTML reports.
- New `--ui` flag to open dashboards directly in the system browser.
- New `html` format for `stdout` and file-based report generation.
- Snippet `visual:` block in frontmatter for KPI and chart configuration (Line, Bar, Area, Pie, Scatter).
- Secure payload injection with automatic HTML escaping and blacklist redaction.
- Bundled React + Recharts + Tailwind UI template for zero-dependency portability.

## [1.17.0] - 2026-05-10

### Added

- `dbcli recover` top-level command. Without `--apply`, prints the auto-saved last envelope (Markdown by default, JSON with `--format json`); with `--apply`, executes the recovery plan under risk gating.
- `--apply` runs `tier=readonly` and `tier=dry-run` steps by default (tier is determined by the code-owned allowlist, not the envelope). Open the gate one tier with `--allow-write=readonly-cmd` (local-side writes) or `--allow-write=write-cmd` (database writes).
- `--from <path>` overrides the auto-saved envelope and accepts either a raw `RecoveryEnvelope` or a `SavedRecoveryEnvelope` wrapper.
- Auto-write `.dbcli/last-recovery.json` on every `--recovery` failure across `query`, `q`, `insert`, `update`, `delete`, `export`, `schema`, and `inspect`. Atomic write; SQL text and sensitive flag values are redacted in the saved `command` summary.
- New optional `GuideStep` fields: `interactive`, `dbWrite`, `placeholders` (additive — no `schemaVersion` bump).
- Per-`error.code` argv allowlist enforced before any child-process execution; hand-authored envelopes cannot escalate beyond the steps dbcli already knows how to run.
- Strict zod-based schema validation for envelopes from `--from <file>` and `.dbcli/last-recovery.json`. Missing `recovery`, missing `error.code`, malformed step shape, or wrong `schemaVersion` all surface as exit code 2 with a structured reason instead of crashing.
- Exit-code matrix for `dbcli recover --apply`: `0` ok, `1` failed, `2` envelope missing/malformed, `3` skipped-only.
- `RecoveryEnvelope.verify?: GuideStep` — optional read-only verifier appended by `classifyError()` per recovery code (additive, no `schemaVersion` bump).
- `dbcli recover --apply` now runs the verifier after the main plan when `finalStatus === 'ok'`. Output gains `verifyResult` and `verifyStatus` (`passed | failed | indeterminate`). `--no-verify` opts out.
- `--no-verify` flag on `dbcli recover --apply`.
- `BLACKLIST_COLUMN_WRITE` allowlist now permits `dbcli inspect --for-agent` (used as the verifier).
- `dbcli recover --next --after-step <n> --result <json|@file>` — multi-turn protocol that returns one deterministic step at a time, given the result of the previous step. Output is a `NextResult` envelope with `kind: 'step' | 'done'`, `cursor`, `totalSteps`, and (when stepping) the next `GuideStep`.
- `--next` is mutually exclusive with `--apply`; `--result` accepts inline JSON or `@<path>` (file ≤ 64 KB; `stdoutSummary`/`stderrSummary` ≤ 4 KB each).
- New `nextStepFromEnvelope` pure function and `StepResultSummary` / `NextResult` types in `src/core/recovery/next-step.ts` + `next-types.ts`. v1 walks the plan linearly; the function signature reserves `prevResult` for future per-code branching without breaking callers.

### Changed

- `dbcli recover --apply` defaults to `--format json` for machine-readability; `dbcli recover` (no `--apply`) keeps `--format markdown` as the default. Either default can be overridden explicitly.
- `dbcli init` and `dbcli init --force` recovery steps are now marked `interactive: true`; `--apply` skips them with `skipped:interactive`.
- Recovery steps that fall back to placeholder tokens (`<table>`, `<hint>`, `<snippet>`, `<name>`, `<value>`) now declare those tokens in `placeholders`; `--apply` skips them with `skipped:placeholder`.
- `dbcli use <connection>` recovery step is now `risk: 'write'` with `dbWrite: false` — selecting a connection rewrites the active-connection field in config.

### Security

- **Trust boundary on `--apply`**: envelope `risk`, `dbWrite`, and `interactive` fields are no longer authoritative for execution decisions. The gate derives the canonical execution tier (`readonly` / `dry-run` / `local-write` / `db-write` / `interactive`) from the per-`error.code` allowlist. A hand-crafted envelope claiming `risk: 'readonly'` for `dbcli delete users --where id=1` is still classified as `db-write` and skipped under the default tier. Falsified `interactive: false` on `dbcli init` is still skipped because the allowlist marks it `interactive`.
- `insert` / `update` / `delete` / `q` are tier `dry-run` only when argv contains `--dry-run`; otherwise they are tier `db-write`.
- Auto-saved envelope source now also rejects (exit 2) when `saved.cwd` no longer exists on disk, matching the existing `--from` saved-envelope behavior.

### Internal

- New modules under `src/core/recovery/`: `apply-types`, `apply-shell`, `apply-allowlist`, `apply-gate`, `apply-exec`, `apply`, `apply-render-json`, `apply-render-markdown`, `last-envelope`, `envelope-schema`.
- `apply-allowlist` exposes `classifyArgvForCode(argv, code)` returning `{ kind, tier }` so the gate can decide tier without trusting envelope hints. `isAllowedForCode` is preserved as a boolean wrapper.
- Test seam `__setExecutorForTests` allows unit tests to swap the child-process executor without spawning real processes.

## [1.16.0] - 2026-05-09

### Added

- `dbcli insert --recovery`, `dbcli update --recovery`, `dbcli delete --recovery`, `dbcli export --recovery`, `dbcli schema --recovery`, `dbcli inspect --recovery` — same opt-in envelope behavior as v1.15.0's `query --recovery` / `q --recovery`. On failure, a `RecoveryEnvelope` JSON is written to stdout, the human stderr message is suppressed, and the process exits non-zero. Without `--recovery`, the existing per-command error behavior is preserved byte-for-byte.
- `dbcli inspect --require-schema-cache` — flag that throws `SCHEMA_CACHE_MISSING` (recovery code) when the active SQL connection has no usable schema cache. Combine with `--recovery` to get a structured envelope. Together with the v1.15.0 `recovery` module this gives the `SCHEMA_CACHE_MISSING` classifier path end-to-end coverage from a real CLI surface.
- New `dry-run` recovery steps prepended to `BLACKLIST_COLUMN_WRITE` and `PERMISSION_DENIED` envelopes when the failing operation was a write (`INSERT` / `UPDATE` / `DELETE`). Agents now get a `dbcli <verb> <table> --dry-run` suggestion as the first step before the existing inventory / inspect / init steps.

### Notes

- `RecoveryEnvelope` shape, `RECOVERY_SCHEMA_VERSION`, and the 14 recovery codes are unchanged from v1.15.0. The new `RecoveryContext.writeOperation` field is optional and additive.
- Other commands (`q` was already covered in v1.15.0; `report`, `guide`, `recovery`, `doctor`, `migrate`, `init`, `use`, etc.) keep their existing error behavior.
- No new runtime dependencies. The classifier and step library remain pure functions.

## [1.15.0] - 2026-05-09

### Added

- `dbcli recovery` — machine-readable error envelope with deterministic recovery commands. Standalone lookup mode: `dbcli recovery --code <CODE>` synthesizes an envelope for any of 14 recovery codes (`CONFIG_MISSING`, `CONN_REFUSED`, `CONN_AUTH_FAILED`, `CONN_TIMEOUT`, `CONN_HOST_NOT_FOUND`, `CONN_UNKNOWN`, `PERMISSION_DENIED`, `BLACKLIST_TABLE`, `BLACKLIST_COLUMN_WRITE`, `SNIPPET_NOT_FOUND`, `SNIPPET_AMBIGUOUS`, `SNIPPET_PARAM_MISSING`, `SCHEMA_CACHE_MISSING`, `UNKNOWN`). Supports `--format json|markdown`, `--list`, `--brief`, `--for-agent`, plus placeholder bindings (`--hint`, `--snippet`, `--table`).
- `dbcli query --recovery` and `dbcli q --recovery` — opt-in flag that, on failure, emits a `RecoveryEnvelope` JSON to stdout (suppressing the usual human stderr message) and exits non-zero. Existing behavior without the flag is unchanged.
- `RecoveryEnvelope` schema (`schemaVersion: 1`) reuses the v1.14.0 `GuideStep` shape and is the first surface to emit `risk: 'dry-run'` and `risk: 'write'` recovery steps.

### Notes

- v1.15.0 wires `--recovery` into `query` and `q` only. Other commands (`insert`, `update`, `delete`, `export`) preserve their current error behavior; broader integration is planned for v1.16+.
- Recovery is reactive (responds to a thrown error) while `dbcli guide` is proactive (chooses next steps before any failure). They share the `GuideStep` contract via `src/core/guide/types.ts`.
- No new runtime dependencies. Classifier and step library are pure functions.

## [1.14.0] - 2026-05-09

### Added

- `dbcli guide <goal>` — deterministic next-command planner for a fixed list of database goals (`slow-query`, `capacity`, `health`, `index-usage`, `permissions`, `schema-overview`). Reuses `dbcli inspect` context cache-first; pass `--probe` to refresh via a live probe. Each step carries `risk: 'readonly'` (forward-compatible with v1.15.0 recovery) plus `rationale` and `expects` (trimmed by `--brief` / `--for-agent`). Supports `--format json|markdown`, `--list`.
- Goal-list view: `dbcli guide --list` returns all available goals with one-line descriptions.

### Notes

- Guide does not execute any commands; it only plans them. All v1.14.0 plans are read-only by construction.
- MongoDB connections still produce a useful plan (anchor + `queries suggest` + `doctor`) even though no built-in mongo diagnostic snippets exist yet.
- Coexists with `dbcli skill tasks plan` (template-driven). Guide is taxonomy-driven from the static goal map.

## [1.13.0] - 2026-05-09

### Added

- `dbcli report` — Markdown / JSON diagnostic report built on top of v1.12.0 inspect collectors. Reuses connection / permission / blacklist / snippet inventory context; runs curated read-only built-in `@diag/*` snippets grouped into `health` / `capacity` / `perf` sections; per-snippet timeout (default 3000 ms) and per-evidence row cap (default 50). Supports `--format json|markdown`, `--section <list>`, `--brief`, `--for-agent`, `--no-connect`.

### Notes

- MongoDB connections emit a context-only report (no built-in mongo snippets in v1.13.0).
- No new built-in snippets in this release; report uses the v1.11 `@diag/*` inventory.

## [1.12.0] - 2026-05-08

### Added

- `dbcli inspect` — read-only context snapshot for AI agents (`--format json|markdown`, `--brief`, `--for-agent`, `--no-connect`, `--probe-timeout`).
- `src/core/inspect/` collector layer (connection, permission, blacklist, objects, schema-cache, snippets, version, suggested commands) reused via the orchestrator.
- `release:check` script — sequences `bun audit`, format check, typecheck, lint, tests, build, and dist smoke.

### Changed

- `assets/SKILL.md` agent workflow now starts with `dbcli inspect --for-agent`.
- `README.md` quick-start documents the agent first-look command.

### Notes

- Snapshot output is locked at `schemaVersion: 1`. Non-SQL engines emit `objects` and `schemaCache` as `unavailable: true` until later milestones.
- No new runtime dependencies.

## [1.11.0] - 2026-05-08

### Added

- `dbcli queries search <keywords>` — fuzzy keyword search across saved queries.
- `dbcli queries suggest <intent>` — intent-prefix suggestion.
- Optional `intent` frontmatter field on snippets.
- 9 new diagnostic snippets: ES x4 (hot-threads, index-stats, unassigned-shards, pending-tasks); Redis x4 (slowlog, client-list, memory-usage, cluster-info); SQL x1 (blocking-queries.postgres).
- "When you don't know which query to run" section in SKILL.md.

### Changed

- All 18 existing built-in diagnostic snippets backfilled with `intent`.
- `foldVariants` extracted from `src/commands/queries.ts` to `src/core/saved-queries/fold.ts`.
- Redis read-only allowlist gained `CLIENT`, `INFO`, `CLUSTER`, `SLOWLOG` for diagnostic snippets.

## [1.10.1] - 2026-05-08

### Fixed

- **Packaged `dist/cli.mjs` 找不到 assets**：1.10.0 bundle 在 `task-paths.ts` / `snippet-paths.ts` 用 `import.meta.dir + ../../../` 解析 builtin 目錄，bundle 後三層往上會跳出 package root，npm 全域安裝的使用者執行 `dbcli queries list` / `dbcli skill tasks list` 讀不到資源。抽出 `src/utils/package-root.ts` 以 `package.json` 走訪定位 root，dev 與 bundle 都正確；`skill.ts` 內既有的 `findPackageRoot` 也收斂到同一處。
- **`dbcli q` 略過 blacklist 檢查（安全）**：`q.ts` 把空字串當作 `tableName` 傳給 `BlacklistValidator.filterColumns`，column-level redaction 永遠不命中；同時也沒呼叫 `checkTableBlacklist`，使用者可以透過 saved snippet 直接 SELECT 黑名單表/欄位繞開保護。改為從 `prepared.rewrittenSql` 抽出主表（SQL）或 `prepared.execHints.index`（ES），執行前先 `checkTableBlacklist('SELECT', target)`，並把真正的 `tableName` 餵給 `filterColumns`；Redis 維持原樣。

### Added

- **dist/ 整合 smoke 測試**：`tests/integration/dist-smoke.test.ts` 從 OS tmpdir 執行 `dist/cli.mjs`，覆蓋 `--version`、`skill --output`、`queries list`、`skill tasks list`，守住 packaged assets path 不再回退。
- **`q` blacklist 迴歸測試**：`tests/unit/commands/q-blacklist.test.ts` 覆蓋黑名單表阻擋、欄位 redact、未受影響 snippet 三種情境。

### Changed

- **Lint release-blocking**：`bun run lint` / `lint:fix` 加上 `--max-warnings=0`；同時清掉 45 個 `@typescript-eslint/no-explicit-any` warnings（以正型替代為主，`elasticsearch-adapter.ts` 因刻意不引入 `@elastic/elasticsearch` SDK 而以檔案層 `eslint-disable` 標註理由）。任何新 warning 從此會擋住 release。

## [1.10.0] - 2026-05-08

### Added

- **Saved Queries 擴展至 Elasticsearch 與 Redis**：`dbcli q @<name>` 與 `queries` 子命令現在能依 frontmatter `engine` 自動切換到對應引擎，並走各引擎專屬的安全管線。
  - **Engine strategy 重構**：runner 透過 `EngineStrategy` 介面分派到 SQL / Elasticsearch / Redis 三個獨立 strategy；既有 SQL 行為以 strategy 形式保留，無行為變更。
  - **Elasticsearch strategy**：
    - Frontmatter 接受 `engine: elasticsearch` 與 `index` 欄位；body 必須是合法 JSON，含 `script` 欄位的 query 直接拒絕。
    - JSON-aware 參數注入：`:name` 僅在 JSON 字串脈絡裡替換，避免破壞語法。
    - Size guard：自動補 `size` 上限；`aggs` 模式下放行但加註警告，分頁 (`from + size`) 過大時提示。
  - **Redis strategy**：
    - 命令白名單（read-only 為主）+ body validation；直接拒絕 unsupported 或寫入命令。
    - Raw 參數注入：`:name` 直接代入字面量並打印 foot-gun 警告，提醒使用者 saved query 內不可放使用者輸入。
    - Size guard：對 range / SCAN 命令的 `COUNT` / `LIMIT` 加上保險上限。
  - **`q` 命令分派**：根據 prepared execution 的 engine family 呼叫對應 adapter，`--dry-run` 依 engine 用對應格式輸出（SQL 維持 SQL、ES 印 JSON body、Redis 印 argv）。
  - **內建診斷 snippet**：
    - `assets/snippets/diag/es-cluster-health.elasticsearch.sql` — ES 叢集健康度摘要。
    - `assets/snippets/diag/redis-key-stats.redis.sql` — Redis key 數量 / type 分佈快照。
- **整合測試**：新增 ES / Redis end-to-end saved query 測試（依本機是否有 Docker 而 skip，與既有 PG / MySQL 測試一致）。

### Changed

- **Redis 驅動**：改用 Bun 內建 `RedisClient`，移除外部 `ioredis` 依賴。
- **Elasticsearch adapter**：refactor 並收斂錯誤訊息與 ExecutionResult 形狀，與 SQL / Mongo / Redis 對齊。
- **文件**：`assets/SKILL.md` 與 `assets/reference.md` 補上 ES / Redis snippet 工作流；`docs/feature-matrix.md` 更新 saved-queries 欄位。

### Fixed

- **`dbcli export`（Redis 分支）**：`result.rowCount` 在 Redis 上可能 undefined 時導致 `tsc --noEmit` 報 TS2322；改為 `result.rowCount ?? result.rows.length ?? 0`，release gate 中的 typecheck 回到 0 錯誤。

## [1.9.1] - 2026-05-07

### Changed

- **Skill 連線設定指引**：`assets/SKILL.md` 加入「Connection setup」章節，補齊 AI agent 協助使用者建立資料庫連線時所需的決策樹與各 engine essentials。
  - 決策樹：v1 vs v2、credentials 來源（`.env` / env-refs / 明文）、權限 tier、`status` + `doctor` 驗證。
  - Per-engine essentials：PostgreSQL / MySQL / MariaDB / MongoDB（含 `mongodb+srv://`）/ Redis（`--name` 為 logical DB index）/ Elasticsearch（basic / Cloud ID / API key）。
  - v2 multi-connection 範例（`--conn-name`、`--env-file`、`use --list`、`--rename`、`--remove`）與 per-connection schema cache 注意事項。
  - env-refs（`{ "$env": "..." }`）說明，以及「不要用 `--force` 把 env-refs 蓋成明文」的 guard。
  - 常見陷阱：SRV DNS、URL 中特殊字元編碼、Redis `--name` 限制、Elasticsearch TLS 設定需手動編輯 `.dbcli`。
  - 同步擴充 frontmatter `description`，加入 `init` / `.dbcli` / auth modes 觸發詞，提升 skill 觸發精準度。

## [1.9.0] - 2026-05-06

### Added

- **Agent Task Packs（plan-only 第一版）**：`dbcli skill tasks list/show/plan` 讓 AI agent 可探索團隊定義的資料庫任務範本並產生安全可審查的執行計畫。
  - 三層儲存：`assets/tasks/`（內建）< `.dbcli-shared/tasks/`（團隊共享）< `.dbcli/tasks/`（個人覆蓋）。
  - Task 檔為 `.md`：YAML frontmatter（name/description/tags/engines/params/safety/steps）＋ markdown agent notes。
  - 嚴格 schema：`safety.mode` 僅接受 `plan-only`、`step.type` 僅接受 `command`，未知欄位直接 fail 解析而非靜默忽略。
  - `plan` 輸出包含原始 `command`、`resolvedCommand`、`argv`（shell-aware 切分），方便 agent 直接消費。
  - 內建第一版 `diagnose-slow-query` 任務作為範例。
- 文件：`assets/SKILL.md` 與 `assets/reference.md` 同步加入 Agent Task Packs 章節；`docs/feature-matrix.md` 補充 `skill tasks` 子命令說明。

### Changed

- `src/core/saved-queries/yaml-mini.ts`：擴充支援 YAML block list 語法（`- scalar`、`- key: value` 起始的 sub-map），以承載 Agent Task Packs 的 frontmatter；既有 saved-queries 解析行為不變、66 個既有測試全綠。

## [1.8.0] - 2026-05-06

### Added

- **Redis 與 Elasticsearch 支援**：`init`、`list`、`schema`、`query`、`status`、`use`、`doctor`、`upgrade`、`completion` 在兩個系統皆真實可用。
  - Redis：`list` 透過 SCAN 取 keys；`schema <key>` 顯示 type/TTL/size/sample；`query` 執行白名單 Redis 指令並走原本權限與黑名單檢查。
  - Elasticsearch：`list` 顯示 indices 與文件數；`schema [index]` 攤平 mapping、揭露 `.fields` multi-fields；`query` 接受 DSL JSON 或 Lucene 字串。
- 文件：`assets/SKILL.md` 與 `assets/reference.md` 同步加入 Redis / Elasticsearch 章節。

### Fixed

- **`insert` / `update` / `delete` / `export` / `diff` 對 Redis / Elasticsearch 的早期錯誤訊息**：先前會落入 SQL DataExecutor 出現「Column ... not found in table」之類誤導訊息，現在直接回傳明確的「不支援」JSON，並指引正確替代路徑（Redis 改用 `query`、Elasticsearch 改用外部工具或 `query --index`）。
- **TypeScript 嚴格度**：`bun run typecheck` 從 43 個錯誤降為 0。
  - `ConnectionConfig` union 加入 `ElasticsearchConnectionConfig`。
  - `ResolvedConnection.connection.system`、`ReplContext.system` 涵蓋 `'elasticsearch'`。
  - `ExecutionResult` 補上 optional `rowCount` / `columnNames`。
  - `getDefaultsForSystem` 涵蓋 redis (6379) / elasticsearch (9200) 預設值。

## [1.7.0] - 2026-05-04

### Added

- `dbcli q @<name>` 執行已保存的參數化 SELECT 片段
- `dbcli queries list/show/new/edit/check` 管理片段
- 兩層片段儲存：`.dbcli-shared/queries/`（共享）+ `.dbcli/queries/`（個人覆蓋）
- 完整安全 invariants：拒絕非 SELECT/WITH、多語句、`${...}` / `{{...}}` 模板語法
- 子查詢式 size guard 包裹 (`SELECT * FROM (...) AS _dbcli_guard LIMIT 1000`)
- 內建 YAML 子集 frontmatter parser（無新增 npm 依賴）
- `queries list/show --format json` 為未來 MCP server 預留契約

## [1.6.0] - 2026-04-23

### Added

- **Full MongoDB Support**: Extended all core operations to support MongoDB.
  - Data operations: `query`, `insert`, `update`, `delete`.
  - Safeguards: Integrated `blacklist` protection and `query-size-guard` for MongoDB commands.
  - Discovery: Implemented schema inspection for MongoDB collections.
  - Diagnostics: Added comprehensive MongoDB environment and connection diagnostics to `dbcli doctor`.
- **Improved AI Skill Installation**: `dbcli skill --install` now deploys both `SKILL.md` (high-level workflow) and `reference.md` (full command syntax and examples) to target platforms (Claude Code, Gemini CLI, Copilot, Cursor).
- **Security model enhancement**: `dbcli init` now defaults to a more secure storage model, placing sensitive connection details in `~/.config/dbcli/` rather than the local project workspace.

### Changed

- **Documentation Refactor**: Updated and synchronized documentation (README, README.zh-TW, SKILL.md) to reflect full MongoDB capabilities and first-step walkthroughs.

## [1.5.2] - 2026-04-22

### Fixed

- **Doctor diagnostics for MongoDB SRV**: `dbcli doctor` now reports whether the current execution environment can resolve `mongodb+srv://` connections directly or only through the DNS-over-HTTPS fallback used by the MongoDB adapter.
- **Documentation**: Clarified the new MongoDB SRV environment diagnostic in README, README.zh-TW, and `assets/SKILL.md`.

## [1.5.1] - 2026-04-22

### Fixed

- **MongoDB SRV Connections**: `mongodb+srv://` URIs are now expanded and connected through the MongoDB adapter, and MongoDB operations consistently use the configured database.
- **MongoDB Documentation**: Clarified SRV URI support and configured-database behavior in README, README.zh-TW, and `assets/SKILL.md`.

## [1.5.0] - 2026-04-21

### Added

- **Layered Schema Cache (Wave 1)**: Integrated file-based persistence for database schemas.
  - New `SchemaWriter` for saving schema snapshots to `.dbcli/schemas/`.
  - Layered schema loading (Hot/Cold) integrated into `configModule`.
  - Per-connection isolation: Each connection now has its own schema directory (`.dbcli/schemas/<connection>/`).
- **Improved Migration UX**: Added proactive hints during schema migration to ensure data consistency.
- **Documentation Update**: Added per-connection schema isolation details to `SKILL.md` for AI agents.
  - Clarified schema storage layout in `.dbcli/schemas/`.
  - Added usage examples for `--use <connection>` with schema commands.

## [1.4.1] - 2026-04-21

## [1.3.0] - 2026-04-02

### Added

- **Skill Update Reminders**: Added automated reminders for updating AI agent skills (`SKILL.md`).
  - New `dbcli upgrade` check that notifies if installed skills are outdated compared to the project's `assets/SKILL.md`.
  - Background check in CLI that displays a one-line reminder to stderr after commands finish.
  - Support for checking skills in `.claude/`, `.local/share/gemini/`, etc.

## [1.2.1] - 2026-03-31

### Fixed

- **Config Loader**: Fixed variable naming in `loadConnectionEnv` call, ensuring correct env files are loaded during connection resolution.

## [1.2.0] - 2026-03-31

### Added

- **Multi-connection Support (v2)**: Support for multiple named database connections in a single project.
  - New `dbcli use` command to switch between connections.
  - Named connections with custom `.env` files via `init --conn-name` and `--env-file`.
  - Global `--use <name>` flag to execute commands against a specific connection.
- **Unified DDL Interface (`migrate`)**: Abstracted DDL operations that work across PostgreSQL, MySQL, and MariaDB.
  - 12 subcommands for managing tables, columns, indexes, and constraints.
  - Intelligent SQL generation per database dialect.
  - Default dry-run mode for safety.
- **Enhanced Data Health Checks**: Added `rowCount` and `size` checks to the `dbcli check` command.
- **Comprehensive Documentation**: Updated README (en/zh-TW) with Internals & Strategy sections and new command references.

### Changed

- **Schema Update Strategy**: Refined how and when the schema snapshot in `.dbcli` is updated.
  - Automatic snapshot refresh after successful `migrate` operations.
  - Real-time schema fetching for data modification commands without affecting the snapshot.

---

## [1.1.0] - 2026-03-30

### Changed

- **Adapter `execute()` 回傳型別重構**: 從 `T[]` 改為 `ExecutionResult<T>`，包含 `rows`、`affectedRows`、`lastInsertId` 欄位，DML 操作（INSERT/UPDATE/DELETE）現在回傳正確的 affected rows 計數
- **Export 覆寫確認**: `export --output` 寫入已存在檔案時會提示確認，可用 `--force` 跳過
- **`ExecutionResult<T>` 介面**: 新增統一的查詢結果型別定義於 `src/adapters/types.ts`

---

## [1.0.0] - 2026-03-28

### Stable Release

dbcli v1.0.0 is the first stable release. All three milestones are complete:

- **M1 (v0.6.0):** Smart REPL — interactive shell with SQL + dbcli commands
- **M2 (v0.8.0):** Schema DDL — CREATE/DROP/ALTER TABLE, INDEX, CONSTRAINT, ENUM
- **M3 (v1.0.0):** Stabilization — documentation, permission matrix, known limitations update

### Added

- **`dbcli migrate` command group** (12 subcommands): Full DDL operations with cross-database support
  - `migrate create <table>` — CREATE TABLE with `--column` spec format (`"id:serial:pk"`)
  - `migrate drop <table>` — DROP TABLE with double confirmation (`--execute --force`)
  - `migrate add-column` / `drop-column` / `alter-column` — Column management
  - `migrate add-index` / `drop-index` — Index management (MySQL `--table` option for DROP)
  - `migrate add-constraint` / `drop-constraint` — FK, UNIQUE, CHECK constraints
  - `migrate add-enum` / `alter-enum` / `drop-enum` — PostgreSQL native ENUM support
- **DDLGenerator interface** with PostgreSQL and MySQL/MariaDB dialect implementations
  - PostgreSQL: SERIAL, native ENUM types, ALTER COLUMN TYPE, double-quote identifiers
  - MySQL: AUTO_INCREMENT, inline ENUM, MODIFY COLUMN, backtick identifiers
- **DDLExecutor**: Unified execution pipeline — admin permission check → blacklist protection → SQL generation → dry-run/execute → schema cache auto-refresh
- **Default dry-run for DDL**: All `migrate` commands preview SQL without `--execute`. Destructive operations also require `--force`
- **142 new tests**: column-parser (17), PG DDL (35), MySQL DDL (25), factory (5), DDL executor (22), schema cache DDL (6), CLI migrate (26), live-db migrate lifecycle (6)

### Fixed

- **Schema comment encoding**: Fixed double-encoded UTF-8 comments from MySQL/MariaDB `information_schema` (e.g., `å¸³è™Ÿ` → `帳號`)
- **MySQL connection charset**: Added `charset: utf8mb4` and `SET NAMES utf8mb4`
- **DDL multi-line SQL execution**: Fixed statement splitting to use `;\n` instead of `\n`
- **MySQL DROP INDEX**: Added `--table` option (MariaDB requires `ON <table>`)

### Changed

- **Permission model**: 4 levels — query-only, read-write, data-admin, admin (DDL requires admin)
- **Known Limitations**: Removed "Read-only schema" and "CLI-only" (both resolved). Added "No migration version tracking" as post-v1.0 item
- **Test infrastructure**: `docker-compose.test.yml` for MySQL 8 + PostgreSQL 16 integration testing
- **Package scripts**: Added `test:unit`, `test:integration`, `test:docker`
- **SKILL.md**: Updated with full `migrate` command reference and AI agent guidelines

### Test Results (v1.0.0)

- Unit/Core: 1082 pass, 0 fail
- Live DB (MariaDB 10.11): 61 pass
- Docker Adapter (MySQL 8 + PG 16): 18 pass

---

## [0.6.1-beta] - 2026-03-28

### Encoding Fix & Test Infrastructure

### Fixed

- **Schema comment encoding**: Fixed double-encoded UTF-8 comments from MySQL/MariaDB `information_schema`. Comments stored through latin1 (cp1252) connections now correctly display CJK characters (e.g., `å¸³è™Ÿ` → `帳號`)
- **MySQL connection charset**: Added `charset: utf8mb4` and `SET NAMES utf8mb4` to MySQL adapter connections

### Added

- **`fixDoubleEncodedUtf8()` utility** (`src/utils/encoding.ts`): Detects and reverses cp1252-to-UTF-8 double encoding with full cp1252 reverse mapping table. Applied to schema comments in both MySQL and PostgreSQL adapters
- **`docker-compose.test.yml`**: MySQL 8.4 (port 3307) + PostgreSQL 16 (port 5433) for integration testing, with health checks and tmpfs for fast ephemeral storage
- **Environment-driven adapter tests**: `mysql.test.ts` and `postgresql.test.ts` now read connection from `MYSQL_*` / `PG_*` env vars, falling back to docker-compose defaults. Auto-skip when DB is unreachable
- **`live-db.test.ts`**: 55 comprehensive CLI-level integration tests covering all commands against live MariaDB — list, schema, query, blacklist CRUD, insert/update/delete lifecycle, export, check, diff, status, doctor, shell, format validation, SQL injection protection
- **New test scripts**: `test:unit`, `test:integration`, `test:docker` in package.json

### Test Results

- Unit/Core: 940 pass
- Live DB (MariaDB 10.11): 55 pass
- Adapter (Docker MySQL 8 + PG 16): 18 pass

---

## [0.6.0-beta] - 2026-03-28

### Interactive Shell — Smart REPL

### Added

- **`dbcli shell` command:** Interactive database shell with SQL execution and dbcli command dispatch
- **SQL-only mode:** `--sql` flag restricts to SQL statements only
- **Auto-completion (Tab):** Context-aware completion for SQL keywords, table names, column names, and dbcli commands
- **Multi-line SQL:** Accumulates input until `;` is found, with `...>` continuation prompt
- **SQL syntax highlighting:** Real-time colorization of keywords, strings, and numbers in verbose mode
- **Meta commands:** `.help`, `.quit`/`.exit`, `.clear`, `.format`, `.history`, `.timing`
- **Persistent history:** Stored in `~/.dbcli_history` (max 1000 entries), with up/down navigation and Ctrl+R search
- **Permission & blacklist integration:** Full enforcement within REPL session — SQL goes through PermissionGuard, query results go through blacklist filtering
- **Auto-reconnect:** Attempts to reconnect once on connection errors, then displays error without crashing the session
- **Error resilience:** SQL/permission/connection errors never crash the session
- **i18n support:** All shell messages available in English and Traditional Chinese
- **102 new tests:** input-classifier (25), multiline-buffer (10), meta-commands (15), completer (17), history-manager (8), command-dispatcher (12), repl-engine (12), shell-command (3)

---

## [0.5.2-beta] - 2026-03-27

### Fixed

- **`init --use-env-refs` permission bug**: Interactive env-ref mode now correctly offers all 4 permission levels (was missing `data-admin`)
- **`init` i18n completeness**: All 10 hardcoded English messages replaced with i18n keys (supports en/zh-TW)
- **`init` duplicate code**: Extracted shared `.dbcli exists` overwrite check into `checkOverwrite()` helper
- **`--use-env-refs` help text**: Improved option description to clarify CI/CD and multi-env use case
- **Documentation**: Added `--use-env-refs` to README (en/zh-TW), CHANGELOG, and SKILL.md with AI agent guidance

---

## [0.5.1-beta] - 2026-03-27

### Added

- **Database version check**: Warns on stderr when connected database version is below minimum supported (PostgreSQL 12+, MySQL 8.0+, MariaDB 10.5+). Non-blocking — connection proceeds normally.
- **`dbcli doctor` DB version check**: New "Database version" item in Connection & Data group.
- **`dbcli init --use-env-refs`**: Store environment variable references (`{"$env": "DB_HOST"}`) in config instead of actual values. Supports interactive and non-interactive modes with `--env-host`, `--env-port`, `--env-user`, `--env-password`, `--env-database` options. Suitable for CI/CD and multi-environment deployments.

### Fixed

- **`init` permission bug**: Interactive env-ref mode now correctly offers all 4 permission levels (was missing `data-admin`)
- **`init` i18n**: All hardcoded English messages in init command replaced with i18n keys (10 messages)
- **`init` duplicate code**: Extracted shared `.dbcli exists` overwrite check into `checkOverwrite()` helper

---

## [0.5.0-beta] - 2026-03-27

### UX & Developer Experience — Colors, Logging, Diagnostics, and Tooling

### Added

- **Color system** (`picocolors`): Semantic color helpers (`success`/`error`/`warn`/`info`/`dim`/`bold`) with automatic `NO_COLOR` support
- **SQL syntax highlighting**: Keywords (blue bold), strings (green), numbers (yellow) — applied in verbose mode and dry-run preview
- **Leveled logger**: Four levels — quiet (`-q`), normal (default), verbose (`-v`), debug (`-vv`) — all output to stderr to keep stdout clean for structured data
- **`--no-color` global flag**: Disable colored output; also respects `NO_COLOR` environment variable (<https://no-color.org/>)
- **`-v, --verbose` global flag**: Increase verbosity (`-v` = verbose, `-vv` = debug)
- **`-q, --quiet` global flag**: Suppress non-essential output
- **`dbcli doctor` command**: Full self-diagnostic — checks Bun version, dbcli version (npm registry), config validity, permission level, blacklist completeness (detects unprotected sensitive columns like `password`/`token`/`secret`), database connectivity, schema cache freshness, and large table warnings (> 1M rows). Supports `--format json` for AI agents. Exits with code 1 on errors.
- **`dbcli completion` command**: Shell auto-completion script generation for bash, zsh, and fish. `--install` flag auto-writes to the shell rc file using idempotent marker blocks.
- **`dbcli upgrade` command**: Self-update from npm registry. `--check` flag for check-only mode.
- **Background version check**: Every command silently checks the npm registry (at most once per 24 hours, cached in `.dbcli/version-check.json`). Shows a one-line hint to stderr after the command completes if a newer version is available. Suppressed by `--quiet`.
- **Table formatter colorization**: Table headers now display in bold
- **62 new tests**: colors (7), sql-highlight (6), logger (10), doctor (12), completion (8), upgrade/version-check (19)

### Dependencies

- Added `picocolors` (~0.4 KB) as production dependency

---

## [0.2.0-beta] - 2026-03-26

### Data Access Control — Blacklist System

Added table and column-level blacklisting to protect sensitive data from AI agent access.

### Added

- **`dbcli blacklist` command suite:** Manage blacklist rules via CLI
  - `blacklist list` — display current blacklist configuration
  - `blacklist table add/remove <table>` — manage table-level blacklist
  - `blacklist column add/remove <table>.<column>` — manage column-level blacklist
- **Table-level blacklisting:** Reject all operations (query, insert, update, delete) on blacklisted tables
- **Column-level blacklisting:** Automatically omit blacklisted columns from SELECT results
- **Security notifications:** Footer in table/CSV/JSON output when columns are filtered (e.g., "Security: 2 column(s) were omitted based on your blacklist")
- **Context-aware override:** `DBCLI_OVERRIDE_BLACKLIST=true` environment variable for temporary bypass with warning
- **i18n support:** Blacklist messages in English and Traditional Chinese
- **Performance:** < 1ms overhead per query (O(1) Set/Map lookups)
- **103 new tests:** 83 core + 12 CLI wiring + 8 formatter security tests
- **`dbcli schema --reset`:** Clear all existing schema data and re-fetch from database — solves stale schema after switching DB connections

### Configuration

Blacklist rules stored in `.dbcli`:

```json
{
  "blacklist": {
    "tables": ["audit_logs", "secrets_vault"],
    "columns": {
      "users": ["password_hash", "ssn"]
    }
  }
}
```

---

## [0.1.0-beta] - 2026-03-26

### Initial Release - AI-Ready Database CLI

dbcli v0.1.0-beta is a complete, production-ready CLI tool enabling AI agents and developers to safely interact with PostgreSQL, MySQL, and MariaDB databases through a permission-controlled interface.

**Key Achievement:** Single command-line tool bridging AI agents (Claude Code, Gemini, Copilot, Cursor) to database access without requiring multiple MPC integrations.

---

## Features by Phase

### Phase 1: Project Scaffold

- **Foundation established:** CLI framework with Commander.js v13.0+
- **Build process:** Bun bundler with native TypeScript support (1.1MB binary, <100ms startup)
- **Test infrastructure:** Vitest with 80%+ coverage target
- **Cross-platform CI:** GitHub Actions matrix testing (ubuntu, macos, windows)
- **Code quality:** ESLint + Prettier configured

**Status:** ✅ Complete

---

### Phase 2: Init & Config

- **`dbcli init` command:** Interactive configuration with `.env` parsing
- **Hybrid initialization:** Auto-fills from .env, prompts only for missing values
- **Config management:** `.dbcli` JSON file with immutable copy-on-write semantics
- **Database support preparation:** Multi-database adapter layer foundation
- **RFC 3986 percent-decoding:** Handles special characters in DATABASE_URL passwords
- **Validation:** Zod schemas for type-safe configuration

**Status:** ✅ Complete

**Commands added:** `dbcli init`

---

### Phase 3: DB Connection

- **Multi-database support:** PostgreSQL, MySQL, MariaDB via unified adapter interface
- **Bun.sql integration:** Native SQL API (zero npm dependencies for drivers)
- **Connection testing:** Validates credentials before saving config
- **Error mapping:** Categorized error messages with troubleshooting hints (5 categories: ECONNREFUSED, ETIMEDOUT, AUTH_FAILED, ENOTFOUND, UNKNOWN)
- **Adapter pattern:** Clean abstraction enabling driver swaps without CLI changes

**Status:** ✅ Complete

**Technical:** DatabaseAdapter interface with PostgreSQLAdapter, MySQLAdapter implementations

---

### Phase 4: Permission Model

- **Three-tier permission system:** Query-only, Read-Write, Admin
- **SQL classification:** Character state machine for robust SQL analysis (handles comments, strings, CTEs, subqueries)
- **Permission enforcement:** Coarse-grained checks (no per-table/column fine-grained control in V1)
- **Default-deny approach:** Uncertain operations require Admin mode
- **Zero external dependencies:** Pure TypeScript string processing

**Status:** ✅ Complete

**Technical:** PermissionGuard module with SQL classifier (120+ unit tests)

---

### Phase 5: Schema Discovery

- **`dbcli list` command:** Display all tables with metadata
- **`dbcli schema [table]` command:** Show single table structure or scan entire database
- **Foreign key extraction:** PostgreSQL FK metadata from pg_stat_user_tables; MySQL from REFERENTIAL_CONSTRAINTS
- **Output formatters:** Table (ASCII) and JSON (AI-parseable)
- **Schema storage:** Complete metadata in `.dbcli` for offline AI reference
- **Column details:** Type, constraints, nullable, defaults, primary keys, foreign keys

**Status:** ✅ Complete

**Commands added:** `dbcli list`, `dbcli schema`

**Output formats:** table, json

---

### Phase 6: Query Operations

- **`dbcli query "SQL"` command:** Direct SQL execution with permission enforcement
- **Output formatters:** Table (human-readable), JSON (AI-parseable), CSV (RFC 4180 compliant)
- **Auto-limiting:** Query-only mode limits to 1000 rows (with user notification)
- **Helpful errors:** Levenshtein distance table suggestions for typos
- **Structured results:** Metadata including row count, execution time, columns
- **Permission guarding:** Blocks write operations in Query-only/Read-Write modes

**Status:** ✅ Complete

**Commands added:** `dbcli query`

**Output formats:** table, json, csv

**Libraries:** Levenshtein distance (custom 30-line implementation, no deps)

---

### Phase 7: Data Modification

- **`dbcli insert [table]` command:** Insert rows with parameterized queries
- **`dbcli update [table]` command:** Update existing rows with WHERE clause and SET columns
- **`dbcli delete [table]` command:** Delete rows (Admin-only for safety)
- **Parameterized SQL:** Prevents SQL injection across all modification commands
- **Confirmation flows:** --force flag for bypass; default prompts user
- **Dry-run mode:** `--dry-run` shows SQL without executing
- **Permission enforcement:** Insert/Update require Read-Write+; Delete requires Admin

**Status:** ✅ Complete

**Commands added:** `dbcli insert`, `dbcli update`, `dbcli delete`

**Safety features:** Confirmation prompts, --dry-run, --force override

---

### Phase 8: Schema Refresh & Export

- **`dbcli schema --refresh` command:** Detect and apply schema changes incrementally
- **`dbcli export "SQL"` command:** Export query results as JSON or CSV
- **SchemaDiffEngine:** Two-phase diff algorithm (table-level, column-level)
- **Type normalization:** Case-insensitive comparison for column types
- **Immutable merge:** Preserves metadata.createdAt, updates schemaLastUpdated
- **Streaming output:** CSV generated line-by-line; JSON buffered for validity
- **File output:** `--output file` support for both export and schema refresh

**Status:** ✅ Complete

**Commands enhanced:** `dbcli schema` (added --refresh), new `dbcli export`

**Output:** JSON (standard), CSV (RFC 4180)

---

### Phase 9: AI Integration

- **`dbcli skill` command:** Generate AI-consumable skill documentation
- **SkillGenerator class:** Runtime CLI introspection (collects commands dynamically)
- **Permission-based filtering:** Query-only hides insert/update/delete; Read-Write hides delete
- **SKILL.md format:** YAML frontmatter + markdown (compatible with Claude Code, Gemini, Copilot, Cursor)
- **Platform installation:** `dbcli skill --install {claude|gemini|copilot|cursor}`
- **Cross-platform paths:** Installs to correct location per platform (.claude/, .local/share/gemini/, etc.)
- **Dynamic updates:** Skill regenerates as CLI evolves; no manual documentation maintenance

**Status:** ✅ Complete

**Commands added:** `dbcli skill`

**Installation targets:** Claude Code, Gemini CLI, GitHub Copilot, Cursor IDE

---

### Phase 10: Polish & Distribution

- **npm publication:** `files` whitelist, `engines` constraints, `prepublishOnly` hook
- **Cross-platform validation:** Windows CI matrix with .cmd wrapper verification
- **Comprehensive documentation:** API reference, permission model, AI guide, troubleshooting
- **Performance benchmarking:** CLI startup < 200ms, query overhead < 50ms
- **Release readiness:** v1.0.0 quality gates met, all requirements satisfied

**Status:** ✅ Complete

---

## Known Limitations

- **Single database per project:** Each directory uses one `.dbcli` config. For multi-database setups, use separate directories or `--config` flag. This is by design, not a technical limitation.
- **No audit logging:** WHO/WHAT/WHEN tracking deferred to post-v1.0
- **No migration version tracking:** `migrate` commands execute DDL directly without version history or rollback. The `migrate` namespace is reserved for future migration tracking support.

---

## Compatibility

### Databases

- PostgreSQL 12+
- MySQL 8.0+
- MariaDB 10.5+

### Runtime

- Node.js 18.0.0+
- Bun 1.3.3+

### Platforms

- macOS (Intel, Apple Silicon)
- Linux (x86_64)
- Windows 10+ (via npm .cmd wrapper)

### AI Agents

- Claude Code (Anthropic)
- Gemini CLI (Google)
- GitHub Copilot
- Cursor IDE

---

## Installation

```bash
npm install -g dbcli

# or use with npx (no installation)
npx dbcli init
```

---

## Quick Start

```bash
# Initialize project with database connection
dbcli init

# List tables
dbcli list

# Show table schema
dbcli schema users

# Query data
dbcli query "SELECT * FROM users"

# Generate AI agent skill
dbcli skill --install claude
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and release process.

---

## License

See LICENSE file for details.

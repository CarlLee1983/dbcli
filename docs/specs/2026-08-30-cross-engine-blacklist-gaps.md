# MongoDB 與 SQL 的黑名單缺口，以及 audit 的其餘問題（第九輪）

**狀態**：已確認，未修復。與
`docs/specs/2026-08-30-redis-blacklist-gaps.md` 同一輪、同一個理由——那一輪的
問題是「**一個比對函式，有沒有把它要比的兩樣東西都正規化？**」，而
`fix/es-shell-permission-enforcement` 只收 Elasticsearch 這條線的修補。

第九輪有三則**已在該分支修掉**，因為它們落在 ES 的線上或是該分支自己造成的：
audit `target` 可被 SQL 註解偽造、`query` 的 DML 記成 `readonly`、以及第八輪
放寬 `VALID_TABLE_NAME` 造成的迴歸。以下是**沒有**修的。

---

## MongoDB

### 1. [CRITICAL] aggregation 換名讓 `blacklist.columns` 完全失效

設定 `columns: { users: ["password"] }`，查詢
`dbcli query '[{"$project":{"leak":"$password"}}]' --collection users`
→ 輸出 `[{"_id":1,"leak":"p1"}]`，原文。`$addFields:{copy:"$password"}` 同理。

`src/core/mongo/field-masker.ts:64-83` 只比對**回傳文件的鍵名**，而 aggregation
可以把受保護欄位的值搬到任何鍵名下。`query-only` 即可。

MongoDB 沒有請求端的欄位檢查——ES 那側第七輪修的 `namesProtectedField`（掃描
請求裡指名的欄位）在這裡沒有對應物。SQL 側的同型是 `SELECT password AS leak`，
但那已由 `src/core/BLACKLIST.md` 明文承認為「顯示過濾器」的上限。MongoDB 沒有
這樣的紀錄。

### 2. [CRITICAL] `_id` 無條件豁免，`$group` 是保證出口

`dbcli query '[{"$group":{"_id":"$password"}}]' --collection users`
→ `[{"_id":"p1"}]`，原文。`field-masker.ts:71-74` 對頂層 `_id` 直接 `continue`。

即使第 1 則改成「比對值的來源」，這條路仍在：`$group` 的輸出鍵必定是 `_id`。

### 3. [HIGH] `$rename` 把值搬出黑名單名稱，而 planner 明說它不外洩

`update --set '{"$rename":{"password":"pw"}}'`。`src/commands/update.ts:258-270`
只從 `$set` / `$unset` 收集 `writtenFields`，所以檢查拿到空集合。`$inc`、`$mul`、
`$push`、`$addToSet`、`$setOnInsert`、`$currentDate`、`$bit` 同樣不在範圍。

更糟的是 `src/core/mongo/dml-plan.ts:194-197` 把 `$rename` 標成 `severity:
'warn'` 並註明「field rename does not exfiltrate data」——**那句話是錯的**：
改名之後 `password` 的值躺在 `pw` 底下，下一次讀取的遮罩碰不到它。這與 ES 分支
第五輪的教訓同型：程式碼裡的斷言本身要當成待驗證的宣稱。

### 4. [HIGH] 讀取端走 path-matcher，寫入端是扁平字串相等

`columns: { users: ["user.password"] }` 對**讀取**有效（MongoDB 這側沒有 ES
第七輪那個含 `.` 的缺陷）。但 `insert --data '{"user":{"password":"x"}}'` 放行：
`src/commands/insert.ts:259` 傳的是 `Object.keys(data)` = `["user"]`，而
`src/core/blacklist-validator.ts:202` 是 `blacklisted.includes(f)`。
`columns: { users: ["user.*"] }` 配 `$set: {"user.password": …}` 也放行。

一份設定、兩個比對器，使用者只得到讀的那一半保護。

### 5. [HIGH] `blacklist.tables` 在 MongoDB 是字面相等

`tables: ["secrets*"]` + `--collection secrets_2026` → 不擋。這是第八輪那則
（ES 的條目端沒展開）的**第三個引擎實例**：同一個陣列在 Redis 是 glob、在 ES
現在兩端都展開、在 MongoDB 只有相等。

### 6. [MEDIUM] 被拒絕的欄位樣式靜靜等於零保護

`columns: { users: ["pass*"] }` → `compilePatterns` 全數 rejected，
`field-masker.ts:49-50` 看到 `patterns.length === 0` 就原樣回傳整份文件，執行時
沒有任何訊息。而唯一寫得出合法 dotted / `foo.*` 樣式的管道是手編設定檔
（`blacklist.ts` 的 `parseColumnIdentifier` 要求剛好兩段）——**唯一能寫出正確
樣式的管道，同時是唯一能寫出無聲失效樣式的管道**。

---

## SQL

### 7. [HIGH] 欄位比對大小寫敏感、表名不敏感，兩端沒有共同的摺疊規則

`blacklist-manager.ts:86` 存欄位原樣、`:95` 表名 `toLowerCase()`、`:129` 用
`columnSet.has(columnName)`。`blacklist column add users.Password` 在 PostgreSQL
設定上寫入成功，但驅動回傳的欄位名是 `password`（未加引號的識別字摺成小寫），
規則永不命中。反向（規則 `password`、`SELECT password AS "PASSWORD"`）同樣不遮。

註解說「column names are case-sensitive」是刻意設計，但那個設計只在兩端摺疊
規則一致時成立，而設定端沒有任何摺疊或提示。

### 8. [MEDIUM-HIGH] 寫入側不做祖先比對

`checkColumnBlacklistOnWrite`（`blacklist-validator.ts:202`）是純字面
`includes`，讀取側 `filterColumnsForTables:357-370` 會沿祖先走。於是規則
`profile` 之下，`$set: {"profile.ssn": …}` **能寫不能讀**。

### 9. [MEDIUM] 設定端不 trim、不解引號

`blacklist-manager.ts:51/86/95` 對條目與鍵都不 `trim()`。`[" password "]`、
`[" users "]`、`['"password"']`、``['`password`']``、`["users.password"]`
（限定名稱被當成點號路徑）、`{"public.users": [...]}` 配未限定查詢——全部靜默
無效。ES 那側 `es-index-target.ts:94` 已經 trim 兼解引號，SQL 側沒有。

---

## audit（其餘）

### 10. [HIGH] audit 的 target 與 blacklist 的表名列舉不是同一套解析

blacklist 走 tokenizer（`query-executor.ts:133`），audit 走單一名稱推導：

- `SELECT * FROM a JOIN salaries s ON …` → blacklist 看到兩張表，audit target
  只有 `a`。
- `CREATE TABLE dump AS SELECT * FROM salaries` → target `salaries`，實際建立的
  `dump` 不在紀錄裡。
- `INSERT INTO staging SELECT * FROM salaries` → target `staging`，讀到的
  `salaries` 不見。

第九輪已修掉「target 可被註解偽造」那一半；**「哪一張表才是 target」這個設計
問題沒有修**。修法方向是兩邊共用 `extractTableReferences`，target 取首張並把
其餘放進 `metadata.tables`。

### 11. [HIGH] `dbcli shell` 只有 tier-two 的閘門決策會進 audit

`src/core/repl/repl-engine.ts` 內沒有任何 `writeAuditEntry`，唯一的稽核來自
`shell-write-gate.ts` 的 `recordGateDecision`，而它 `if (verdict.tier !== 'two')
return true`。也就是在 shell 打的 SELECT 與 tier-one 的 UPDATE／DELETE／INSERT
完全沒有稽核列。

**注意**：這是純讀碼結論，未端到端跑過互動 shell。ES shell 這側已經每個請求
兩列（attempt / outcome），SQL shell 這側是這個狀態——落差很大，值得先端到端
確認再動手。

### 12. `redactSql` 的界線沒寫下來（非缺陷）

`DELETE FROM users WHERE id = 12345` → `redacted_sql` 的 `id = 0`，
`IN (1,2,3)` → `(0,0,0)`。紀錄說得出「對 users 做了 DELETE」，說不出「刪了
哪一列」。這是合理的隱私取捨，但 `integration-helper.ts:198-206` 的註解只解釋了
Elasticsearch 的例外，沒寫下「SQL 的 statement 刻意不足以識別受影響的列」。
補一句即可。

---

## 給下一條分支的建議

1. MongoDB 的 1、2 兩則是同一個根因（遮罩只看回傳的鍵名，而查詢語言可以自由
   換名），要一起設計，不要各補各的。
2. 4、5、8、9 是**同一個問題的四個實例**：一份設定、每個引擎各自的比對器。
   第八輪在 ES 上的修法（讓兩端走同一套展開）是可以照抄的形狀。
3. 3 與 dml-plan 的那句註解一起改——錯的斷言比缺的檢查更危險，因為它讓下一個
   人不去查。

---
status: accepted
date: 2026-08-05
---

# 連線逾時的覆寫在建立 adapter 時才解析，不進入設定物件

連線逾時有兩個來源：連線設定檔的 `timeout` 欄位（持久）與 root-level 旗標
`--timeout <ms>`（單次執行）。優先序是 `--timeout` > 設定檔 > 各 adapter 內建的
5000ms。解析的**位置**是 `AdapterFactory` 的三個生成入口，而不是
`configModule.read()`。

## 背景

所有 adapter 都讀 `ConnectionOptions.timeout`，但在此之前沒有任何設定欄位或
CLI 旗標餵得進去，5000ms 形同寫死。實測使用紀錄中，MongoDB 跨 VPN 與連 Atlas
時反覆出現 `Server selection timed out after 5000 ms`，呼叫端只能自己寫重試迴圈。

第一版實作把解析放在 `configModule.read()` 的出口，因為每個指令都是把
`config.connection` 直接當成 `ConnectionOptions` 使用，在那裡解析一次最省接線。
Code review 實測推翻了這個做法：`blacklist` / `init` / `schema` 等指令走的是
read → 改一個欄位 → `configModule.write()`，而 `write()` 會把 `config.connection`
整包序列化。於是 `dbcli --timeout 45000 blacklist add users` 這種與逾時無關的
指令，會把 45000 永久寫進 `config.json`，之後每次執行都吃到它。

## Considered options

- 在 `configModule.read()` 解析，並於 `write()` 進入點剝除 runtime-only 欄位。
- 在 `AdapterFactory` 的生成入口解析，設定物件全程不帶覆寫值（本案）。
- 讓每個指令自己把旗標傳給 adapter。

第一案要求 `write()` 持續維護一份「哪些欄位是 runtime-only」的黑名單，新增欄位
時忘記加入就會再次洩漏，而洩漏的形式是靜默寫檔——最難發現的那種。第三案把同一段
接線散到數十個呼叫點，任何遺漏都會表現為「旗標對這個指令沒用」。第二案讓「設定
物件永遠只代表磁碟上的內容」成為可檢查的性質：覆寫值存在的時間僅限於一次 adapter
生成，結構上沒有路徑能把它寫回檔案。

## Consequences

- 全域覆寫狀態放在 `src/utils/connection-timeout.ts` 這個無相依模組，而不是
  `src/core/config.ts`。`src/adapters/` 至今不曾 import `src/core/`，維持這個
  方向的分層比少一個檔案重要。
- 解析點是 `createSqlAdapter` / `createQueryableAdapter` / `createRedisAdapter`
  三處。`createRedisAdapter` 直接 `new RedisAdapter()` 而非委派，是必要的第三處
  而非重複；新增任何繞過這三者的生成路徑，旗標就會對該路徑失效。
- `dbcli init` 的連線測試也走 `AdapterFactory`，所以第一次設定 MongoDB 時
  `--timeout` 同樣生效——那正是最容易卡住的一步。
- 下限訂為 100ms 而非 1ms：`--timeout` 在沒有另外指定語句逾時時也會成為語句
  逾時，過小的值會讓每一句 SQL 立刻失敗，且錯誤訊息長得像連線問題。
  （2026-08-13 更新：原本的理由是「PostgreSQL adapter 把同一個值同時給
  `connectionTimeoutMillis` 與 `statement_timeout`」。逾時已拆成連線與語句兩個
  概念——連線逾時保留 5000ms 內建預設，語句逾時預設不存在，交給伺服器決定；
  規則在 `src/adapters/timeout-policy.ts`，新增的 `--statement-timeout` 讓兩者
  可以分別調整。下限的結論不變，理由改成上面這條。）
- `timeout` 是唯一不接受 `$env` 參照的連線欄位。逾時不是機密，且
  `resolveEnvReferences()` 目前只對 `port` 做字串轉數字；要支援得一併擴充轉型
  規則。此限制已寫入使用者文件。

**Falsified if:** `resolveConnectionTimeout()` in `src/utils/connection-timeout.ts`
被 `configModule.read()` 或 `configModule.write()` in `src/core/config.ts` 呼叫，
或 `createSqlAdapter()` / `createQueryableAdapter()` / `createRedisAdapter()` in
`src/adapters/factory.ts` 其中任一不再套用 `withResolvedTimeout()`。

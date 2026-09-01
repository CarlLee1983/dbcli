# 巢狀鍵上的萬用字元規則，SQL 與 Elasticsearch 的讀取路徑碰不到

**狀態**：已修復（2026-09-01）。發現於 ADR-0020 的驗證過程，不屬於那份記錄要
處置的大小寫維度，因此當時只記錄不動手。修法沒有新的決策要記——ADR-0019
Decision 2 已經寫下「一份設定一個比對器」，這裡只是把讀取路徑補上它缺的那一半。

修復後同一組實測（PostgreSQL 16、同一份 `jsonb` 資料）：

| 規則 | 修復前 | 修復後 |
| --- | --- | --- |
| `profile.SS_num` | `{"city":"tp"}` | `{"city":"tp"}` |
| `profile.ss*` | **原文回傳** | `{"city":"tp"}` |
| `profile.*` | 整欄省略 | 整欄省略 |
| `pro*.ss*` | **原文回傳** | `{"city":"tp"}` |
| `profile.zz*`（不該命中） | 原文回傳 | 原文回傳 |

做法是 `filterColumnsForTables` 在有「點分且帶萬用字元」的規則、而且結果裡真的有
巢狀記錄時，才列舉頂層鍵以下的路徑（`nestedFieldPaths`），深度以最長的那條規則
為上限。兩個條件都不成立的設定——絕大多數——一步都不走。1000 列 × 20 個巢狀鍵 ×
10 條點分萬用字元規則實測 7–13ms，已加進 `tests/perf/blacklist-performance.bench.ts`。

## 現象

PostgreSQL 16、`jsonb` 欄位 `profile` 內容 `{"SS_num":"111-22","city":"tp"}`，
2026-09-01 實測：

| 規則 | 結果 |
| --- | --- |
| `profile.SS_num` | 欄位被省略 |
| `profile.ss_num` | 欄位被省略（ADR-0020 之後） |
| `profile.ss*` | **原文回傳** |
| `profile.*` | 欄位被省略 |

MongoDB 的讀取遮罩三種寫法都認得。同一個鍵在兩個引擎上有兩種意思，正是 ADR-0019
要消滅的形狀。

## 原因

`filterColumnsForTables`（`src/core/blacklist-validator.ts`）用兩條路處理點號規則：

1. 字面規則走 `hasFieldPath` 下潛巢狀記錄，找得到就把整個欄位放進 `omitted`。
2. 萬用字元規則只比對 `presentColumns`——那是列上的**頂層鍵名**，加上 Elasticsearch
   攤平後產生的點號鍵。PostgreSQL 的 `jsonb` 回傳的是物件，巢狀鍵從來不出現在
   那個集合裡，所以 `profile.ss*` 沒有任何東西可比。

`profile.*` 之所以擋得住，是因為它的尾綴萬用字元形式匹配頂層的 `profile` 自己，
與巢狀無關。

## 修的話要動什麼

讀取路徑得像 MongoDB 的遮罩那樣列舉巢狀路徑，而不是只列頂層鍵名。成本落在
`probeNested` 那條已經標了 benchmark 的路上（`docs` 內的註解記著 1000 列 × 60 個
未命中的點號規則從 12.1ms 降到 0.2ms 的那次最佳化），所以要一併重量。

判準與 ADR-0019 Decision 2 相同：一份設定不該因為引擎不同而有不同意思。

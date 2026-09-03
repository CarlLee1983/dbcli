# ForgeFlow Handoff

DBCLI-011 是最後一個 Story，已交付；工作區乾淨。

DBCLI-002 到 DBCLI-010 與 DBCLI-012 先前已在本分支交付
(`ca123683`、`743688a3`、`49cbb6b8`、`bc8dd329`、`363436ff`、`41983853`、
`3278b6fd`、`0861bd41`、`e84f889b`、`6af7592f`)，ForgeFlow 0.3.0 遷移為
`ee3c9907`。DBCLI-001 由更早的交接紀錄記為已交付；該說法沿用至今，仍未重新驗證。

DBCLI-007 到 DBCLI-011 都以 baseline conformance 執行：先逐條驗證現況，只在
驗收條件真的不成立的地方改碼。

DBCLI-011 有兩個條件不成立，都落在失敗輸出。第一個是 R5：
`rejectUnknownKeys` 把被拒絕的 JSON property key 內插進診斷路徑，而那個 key
完全由產物作者控制——實測 `contract validate` 的 stderr 與
`contract drift --format json` 會原樣印出帶憑證與絕對路徑的 key。現在改為列出
允許的 property 名稱，不再複述被拒絕的那一個。第二個是 R1：subject 的形式從未
被檢查，只檢查是否還在 registry 裡，所以 `table:orders` 這種不支援的形式被判為
`stale`——與「model 被改名」同一個判決。形式檢查移到 parse 階段，形式不合現在是
`invalid`，`stale` 只留給形式正確但已不存在的 reference。

Code review 又找出三件事。最重要的是形式檢查本身：第一版把 `field:` 的欄位部分
限制成 `[A-Za-z_][A-Za-z0-9_$]*`，但 `semanticReferenceRegistry` 是直接用可見
schema 的欄位名組出 `field:<model>.<column>`，帶連字號、點或非 ASCII 的欄位都
會被它送出來。那會讓一份 subject 確實在 registry 裡的合法產物從 PASS 變成
fail closed，是 baseline conformance Story 不該引入的回歸。欄位部分現在只排除
換行，實際的邊界由 registry 成員檢查負責。`isCanonicalSemanticReference` 沒有
被重用，因為它同樣窄——它守的是 agent 產生的 query draft，不是已審閱的本機產物。

另外兩件是命令邊界：`fail()` 直接印任何 Error 的 message，而 `configModule.read`
的錯誤帶絕對路徑（與 DBCLI-010 同一類），現在走 exact-match 的 `safeMessage`；
`collectContractEvidence` 用 `loadSnippets` 卻只需要 key，等於讀並解析每一份
saved query 的 SQL body 還把解析警告印到 stderr，違反 loader 自己寫明的邊界，
改用 `listSnippetKeys`。

新 subject 形式訊息刻意含 "reference" 一字，因為 `src/core/context/context-v2.ts`
用 `message.includes('reference')` 分類錯誤碼；不這樣寫會把已交付的
`INVALID_RESOURCE_REFERENCE` 悄悄改成 `INVALID_SEMANTIC_CONTEXT`。那個 substring
判斷本身很脆弱，但收斂它不屬於本 Story。

`validateSubjects` 先查 blacklist 再查形式，所以形式錯誤不會蓋掉「這個 subject
指向受保護資料」這個對審查者更重要的訊號。

文件方面：英文版 Pages guide 缺了中文版有的 evidence policy 列舉；四個
`docs/user/{en,zh-TW}/index.{md,html}` 版面本來就對齊，新增的兩條行為由
`tests/unit/skill-assets/semantic-contract-docs.test.ts` 釘住。
`semantic-contracts` 已加入 `tests/docs/guides-pages.test.ts` 的 `guideSlugs`，
現在只剩 `verification-evidence` 不在結構檢查內。

新增的每一條斷言都做過 mutation 檢查：把行為改回舊版，對應的測試會紅。

`make verify` 仍因與任何 Story 無關的原因無法 PASS：`bun audit` 回報兩個既有的
moderate 漏洞（eslint 依賴的 `@humanfs/node`、`mysql2`）。`package.json` 與
`bun.lock` 未被本次工作動到。其餘 24 個步驟逐項執行全部通過，包含
`SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test`
（6357 pass、0 fail）。

分支仍未推送，也沒有 PR。已知的產品缺口沒有剩下的了。

## 未在本 Story 範圍內的待辦

- `src/core/data-access/index.ts:285` 仍用 `` `${path}.${key}` `` 內插被拒絕的
  key，與本 Story 修掉的是同一類。目前被 `src/commands/impact.ts` 的訊息
  allowlist 擋住，但三個同級 validator 現在有三種寫法。
- `context-v2.ts` 以 substring 判斷錯誤分類。
- 四個 doc-contract 測試共用相似的文字正規化卻各自 scope；沿用 DBCLI-009 的
  決定不合併，合併會改到已交付 Story 的斷言語意。

## Lifecycle

```yaml
workflow:
  current_story: none
  next_story: pending
  completed_stories:
    - DBCLI-001
    - DBCLI-002
    - DBCLI-003
    - DBCLI-004
    - DBCLI-005
    - DBCLI-006
    - DBCLI-007
    - DBCLI-008
    - DBCLI-009
    - DBCLI-010
    - DBCLI-011
    - DBCLI-012
  status: awaiting_selection

baseline:
  repository: CarlLee1983/dbcli
  branch: feat/forgeflow-stories-002-006
  commit: pending
  dirty_worktree: false
  story_owned_paths: []
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: blocked_on_preexisting_bun_audit
```

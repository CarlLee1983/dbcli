# ForgeFlow Handoff

十二個 Story 全數交付，已於 PR #144 合併進 `main`（merge commit `04a88a44`），
合併後的收尾為 PR #145（`a2a05cc2`）。沒有已知的產品缺口，也沒有選定中的
下一個 Story。

## 交付紀錄

DBCLI-001 到 DBCLI-012 都在 `feat/forgeflow-stories-002-006` 上完成，該分支
已合併並刪除。每個 Story 的理由寫在自己的 commit body 裡，比這份摘要完整——
要理解某個決定為什麼是那樣，讀 commit，不要從這裡重新推導。

DBCLI-007 到 DBCLI-011 是 baseline conformance：先逐條驗證現況，只在驗收條件
真的不成立的地方改碼。五個 Story 加起來，**每一個不成立的條件都落在失敗輸出，
沒有一個在 happy path**。這是這批工作最值得記住的一件事：邊界本身大多早就是
對的，會出問題的是它壞掉時說了什麼。

DBCLI-001 的交付狀態已驗證並結案。它跨十份交接紀錄被記為已交付卻從未查證，
其中四份還逐字寫著「該說法沿用至今，仍未重新驗證」。查證只花了兩分鐘：它是一個
只加測試的 Story，兩項產出都在 `3a310d08` 裡——早於 `Story:` trailer 慣例，所以
沒有 commit 認領它。兩支測試已重跑通過。結論是那個宣稱一直是真的；問題不在它是
假的，而在沒有人檢查，而沒被檢查的宣稱會靠慣性一直活下去。

## 流程版本

採用 ForgeFlow 0.3.1（`specs/.forgeflow-adoption`）。0.3.1 新增上游的
`story-check` 與 `handoff-check` 兩支靜態結構檢查——它們住在 ForgeFlow 的
checkout 裡，CI 跑不到，而且文件明說它們不判斷宣告是否屬實。

`make verify` 因此多了一步 `bun run forgeflow:check`，補的是上游明說不做的那一
層：把 `completed_stories` 與 repository 實況對帳。升級到 0.3.1 時，上游的
`handoff-check` 立刻抓出這份紀錄用了協議裡不存在的 `next_story: none` 與
`status: all_delivered`，兩個值都是前一個 session 憑語意自己造的。

## 合併後的收尾

`chore/post-forgeflow-cleanup` 處理了 DBCLI-011 的 code review 留下、但不屬於
該 Story 範圍的三件事：

- `src/core/data-access/index.ts` 的 `rejectUnknownKeys` 仍把被拒絕的 key 內插
  進診斷路徑，與 DBCLI-011 修掉的是同一類。已改為列出允許的屬性名稱。
- `context-v2.ts` 用 `message.includes('reference')` 判斷錯誤碼。實際查過之後
  這個 substring 比對比 review 講的更糟：它把「重複的 reference」與「來源檔
  路徑不可用」也一併判成 `INVALID_RESOURCE_REFERENCE`。三個模組現在各自匯出
  一個以具名常數做精確比對的述詞，判斷留在擁有那些訊息的模組裡。
  `INVALID_RESOURCE_REFERENCE` 先前完全沒有測試覆蓋，這正是過度分類沒被發現
  的原因；現在六個分類情境都有測試。
- `verification-evidence` 併入 `guides-pages` 的 `guideSlugs`。同時加上一個
  讀目錄的檢查：`guideSlugs` 是手維護的清單，曾經有三份 guide 長期落在結構、
  連結與英文純度檢查之外，靠人維護清單擋不住第四份。

順帶：DBCLI-011 的 subject 形式訊息當初刻意含 "reference" 一字，只為了遷就那個
substring 比對。述詞落地後那個字不再承載任何東西，訊息已改回
`must use a supported semantic subject form`。

## 仍未處理

- 四個 doc-contract 測試共用相似的文字正規化卻各自 scope。沿用 DBCLI-009 的
  決定不合併：合併會改到已交付 Story 的斷言語意。

（先前這裡記著「`loadSemanticContext` 不拒絕 `version: 2` 的 semantic 產物，
還沒判斷是不是缺陷」。已查證：不是缺陷。`src/core/semantic/index.ts:486` 明確
接受 1 與 2，v2 就是加上 `relationships` 的版本，同檔案的 `migrateSemanticContext`
專門把 v1 升成 v2。誤判來自我當時想找一個形狀錯誤的產物、隨手用了 `version: 2`。
允許的 key 集合隨版本走，所以 v1 產物帶 `relationships` 會被擋而非靜默忽略；
`version: 3` 與字串 `"2"` 都會被拒。）

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
  status: done

baseline:
  repository: CarlLee1983/dbcli
  branch: main
  commit: a2a05cc2e11e0754339e734d1db5319ec6744693
  dirty_worktree: false
  story_owned_paths: []
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: pass
```

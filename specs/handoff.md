# ForgeFlow Handoff

這個檔案是留給下一個接手的人或 agent 的：現在的 baseline、還沒有其他歸屬的東西，
以及底下那個被 gate 讀的 lifecycle block。

**已交付 Story 的理由不在這裡。** 它在交付那個 Story 的 commit body 裡——比任何摘要
完整，而且跟著那個變更一起走——決定則在 `docs/adr/`。這份檔案曾經每交付一個 Story 就
多一節敘事，一千一百多行裡有八百多行是那種東西，因為從來沒有東西要求刪掉任何一行。
現在 `bun run forgeflow:check` 會拒絕一個標題指名 `completed_stories` 已記錄的 Story
的段落。決定與移除許可在 ADR-0036。

要理解某個決定為什麼是那樣：`git log --grep 'Story: <ID>'`，或讀 `docs/adr/`。

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

採用 ForgeFlow 0.7.0。權威記錄是 `specs/.forgeflow-adoption`，這裡只是複述，
而複述正是 DBCLI-013 要修的東西：這段話在 marker 與 `specs/stories/README.md`
都已經推進到 0.3.2 之後，還原樣說著 0.3.1，跨兩個已合併的 PR 沒有人看。

0.3.1 新增上游的 `story-check` 與 `handoff-check` 兩支靜態結構檢查——它們住在
ForgeFlow 的 checkout 裡，CI 跑不到，而且文件明說它們不判斷宣告是否屬實。

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

## 結案紀錄

沒有未處理項目。以下兩條原本記在這裡待辦，結論留在原地而不是刪掉——刪掉會讓下一
個人重新踩一次同樣的誤判。


（先前這裡記著四個 doc-contract 測試的正規化重複、沿用 DBCLI-009 的決定不合併。
已處理，但範圍比原本描述的窄：四支裡只有兩支的正規化真的相同，`impact` 不做
lowercase 也不收合 CJK 換行，`verification-receipt` 多一條標點貼合規則、而且是先
去標記再定位段落。共用的只有讀檔與去標記，以及那兩支真正相同的部分；各自的 tail
與 scoping 原封不動，所以沒有任何已交付 Story 的斷言語意被改動——這一點是以四支
× 四個 surface 的正規化輸出雜湊逐位元組比對證明的，不是靠測試通過推論的。）

（先前這裡記著「`loadSemanticContext` 不拒絕 `version: 2` 的 semantic 產物，
還沒判斷是不是缺陷」。已查證：不是缺陷。`src/core/semantic/index.ts:486` 明確
接受 1 與 2，v2 就是加上 `relationships` 的版本，同檔案的 `migrateSemanticContext`
專門把 v1 升成 v2。誤判來自我當時想找一個形狀錯誤的產物、隨手用了 `version: 2`。
允許的 key 集合隨版本走，所以 v1 產物帶 `relationships` 會被擋而非靜默忽略；
`version: 3` 與字串 `"2"` 都會被拒。

DBCLI-013 重驗了這個結論，成立。但重驗時發現真正該追蹤的不是那個懷疑，而是
`grep -rn "equal 1 or 2" tests/` 沒有任何命中：這個接受集合完全沒有回歸測試。
結論目前只靠一次原始碼閱讀與這段散文支撐，兩者都不會在有人改動 `parseContext`
時發出聲音。已開成 issue #150，不再只留在這裡。)

## DBCLI-PLAT-009 — Skill Author Integration Kit

Issue #159 is implemented without a formal ForgeFlow Story. The shipped
`assets/integration-kit/` contains a runnable Bun/TypeScript consumer fixture,
strict public-contract parsing and schema pins, a Task Pack `safety.requires`
example, and correlation/evidence guidance. Its integration test exercises
catalog discovery plus successful and unsuccessful Operation Envelope
preflight against the real CLI. `make verify` passed with 6,744 tests.

## 收尾：PR #172 合併，以及 R3 的真實 runner 數字

PR #172 於 `dbf2c5d7` 合併進 main，CI 十一個 job 全綠（三個 OS × 兩個 Bun 版本，
外加 format、audit、integration、build-determinism、docs-parity）。DBCLI-014 與
DBCLI-015 進 `completed_stories`，`status` 推到 `done`——ForgeFlow 的 DONE 這下
merge policy 也滿足了。

順帶補掉審查留下的最後一個缺口。DBCLI-015 的 R3 要求預算「在它會跑的那台 runner
上量」，而合併前那些常數旁邊寫的是「這台機器 0.14ms，乘三倍推估 runner」——推估
不是量測。現在 CI 真的跑過了，數字直接抄回註解：100-table 預算在 ubuntu 0.08ms、
macos 0.07ms、windows 0.27ms，最慢的一台離 2ms 還有 7.4 倍；1000-table 是
0.10 / 0.07 / 0.20ms，跟 100-table 分不出來，這正是 set 查表該有的樣子。

比值那對測試也拿到了跨平台的數字：set 查表 1.03–1.15，線性掃描 8.33–9.49，門檻 3
在兩者中間，兩側都有餘裕。三個 OS 的絕對速度差了快四倍，比值卻幾乎不動——這就是
當初選比值而不選毫秒數的理由，現在有量測撐著，不只是論證。

## SQLite 宣告對帳之後留下的兩個量測

DBCLI-040 之後，`tests/integration/sqlite-cli/` 是 SQLite 能力宣告的證據來源：矩陣裡
`supported` / `limited` 的每一格都要有一條 spawn 真的 CLI 的情境，情境跑過且
通過才算數。盤點時量到的兩件事留在這裡，都不在 DBCLI-040 的範圍內：

- `schemaFullScan` 對 SQLite 標成 `unsupported`，但 `dbcli schema`（無引數）與
  `schema --refresh` 在 SQLite 上實際跑得完並寫進快取。矩陣少認領了一格；
  要不要認領是產品決定，認領時對帳會要求一條情境。
- `auditHealth` 的計數器（`currentEntryCount`、`currentSizeBytes`）是該程序自己
  的 writer 的，每次 spawn 都從 0 起算；跨程序能觀察的只有它指的檔案。情境
  斷言的是檔案路徑與內容，不是計數器。

## Lifecycle

`current_story` 與 `next_story` 永久是契約的 sentinel。要知道現在該做什麼，問
`forgepilot next`，不要問這個區塊。

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
    - DBCLI-013
    - DBCLI-PLAT-001
    - DBCLI-PLAT-004
    - DBCLI-PLAT-005
    - DBCLI-PLAT-006
    - DBCLI-PLAT-011
    - DBCLI-PLAT-012
    - DBCLI-PLAT-013
    - DBCLI-PLAT-007
    - DBCLI-014
    - DBCLI-015
    - DBCLI-016
    - DBCLI-017
    - DBCLI-018
    - DBCLI-019
    - DBCLI-020
    - DBCLI-021
    - DBCLI-022
    - DBCLI-023
    - DBCLI-024
    - DBCLI-025
    - DBCLI-026
    - DBCLI-027
    - DBCLI-028
    - DBCLI-029
    - DBCLI-030
    - DBCLI-031
    - DBCLI-032
    - DBCLI-033
    - DBCLI-034
    - DBCLI-035
    - DBCLI-036
    - DBCLI-040
  status: done

baseline:
  repository: CarlLee1983/dbcli
  branch: main
  commit: 749028106fdc089194bdd9c218302de1c4aa312c
  dirty_worktree: false
  story_owned_paths: []
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: pass
```

# ForgeFlow Handoff

十二個 Story 全數交付，已於 PR #144 合併進 `main`（merge commit `04a88a44`），
合併後的收尾為 PR #145（`a2a05cc2`）。目前進行中的是 DBCLI-013，收 ForgeFlow
導入本身的尾——採用版本的對帳、發布前的盤點，以及把仍留在這份散文裡的風險移出去。
沒有已知的產品缺口。

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

採用 ForgeFlow 0.3.2。權威記錄是 `specs/.forgeflow-adoption`，這裡只是複述，
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

## DBCLI-013：採用版本的對帳

`specs/.forgeflow-adoption` 與 `specs/stories/README.md` 在 `049d7d55` 推進到
0.3.2 之後，這份文件仍宣告採用中的是 0.3.1，跨 `0c04d091`、`88ec1ad9`、
`7f534be5` 三個已合併的狀態沒有任何東西比對過。版本從來不是行為的一部分，這正是
它會漂的原因：沒有東西讀的欄位不記錄任何事情。

`scripts/check-forgeflow-adoption.ts` 把 marker 定為唯一權威，README 必須以固定
形式複述 version 與 revision 兩者，其餘採用面（本文件、Story template、本地
`story-development` Skill）可以提到某個 ForgeFlow 版本，但不能指名另一個版本為
採用中的版本。

規則刻意畫得窄：只匹配緊接在 `ForgeFlow` 一詞之後的版本號。這些文件本來就會談論
較早的 release——README 的「first adopted at 0.3.0」、本文件的「0.3.1 新增上游的
`story-check`」與「升級到 0.3.1 時」——把句子裡任何位置的版本號都算成漂移的 gate，
一週內就會被關掉。這是 `context-v2` 那次 `message.includes('reference')` 的教訓，
換一個地方重演的機會。

gate 分不出「宣告一個舊版本」與「引用一段宣告了舊版本的文字」——這一段原本
逐字引用了那句漂掉的話，gate 立刻擋下來，於是改成不逐字引用。這是刻意留著的取捨：
要分辨兩者需要理解語意，而一個會猜語意的 gate 比一個偶爾要求換句話說的 gate 危險
得多。要引用時，把版本號寫在 `ForgeFlow` 一詞之外即可。

gate 不碰網路。marker 記著一個上游 revision，但沒有任何東西去取它：離線查不到那個
revision 是否存在，所以不宣稱；能查的是這個 repository 對它是否只給一個答案。

既有的 `check-forgeflow-handoff.ts` 原封不動，兩支互不涵蓋——一支對帳交付宣稱，
一支對帳流程版本。

## Lifecycle

```yaml
workflow:
  current_story: DBCLI-013
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
  # DBCLI-013 sits on top of this commit; it is the state the Story was
  # developed against, not the state after it. `a2a05cc2` was the previous
  # baseline and is an ancestor of this one.
  commit: 7f534be5
  dirty_worktree: true
  story_owned_paths:
    - specs/stories/DBCLI-013-forgeflow-adoption-hardening/
    - scripts/check-forgeflow-adoption.ts
    - scripts/lib/forgeflow-adoption.ts
    - tests/contract/forgeflow-adoption.test.ts
    - specs/handoff.md
    - package.json
    - CHANGELOG.md
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: pass
```

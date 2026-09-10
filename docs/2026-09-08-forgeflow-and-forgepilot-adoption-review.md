# ForgeFlow／ForgePilot 導入六天後的評估

這份評估原本寫在 `specs/handoff.md` 裡。它不是任何一個 commit 的訊息，也不是一份
決策記錄——它是一次帶著數字的判斷，而 handoff 是「留給下一個人」的檔案，不是存放
評估的地方。DBCLI-033 把它搬到這裡，一個字沒改（除了這段說明與下面的標題層級）。

寫在這裡是因為它有失效條件，而失效條件需要一個未來的人回來對照。分開評，因為兩套
東西的證據等級差很多：ForgeFlowV2 用了六天（2026-09-02 起，23 個 Story 結案，
1922 個 commit 裡 37 個帶 `Story:` trailer），ForgePilot 用了一天（2 件 Work
Item）。n=2 談不上 track record。

### ForgePilot：已經回本

它買到的是「同一個 commit 可重複驗證，而且在乾淨環境跑」。一天內找到兩個本機看不
見的缺陷：

1. 一條假裝在測效能的測試。同一個 commit 連跑兩次驗證，一次 FAIL 一次 PASS——那
   條 blacklist 查表預算是單次 `performance.now()`，跟 6,700 支測試一起跑讀到
   21.43ms／10ms，單獨跑則連過三次。DBCLI-015 整個 Story 是這件事的產物。
2. `make verify` 在乾淨 checkout 根本跑不起來。`prettier: command not found`，
   `tsc` 從 PATH 解析到別的版本。本機永遠撞不到，因為 `node_modules` 一直在。

兩個都不是人會發現的：人不會在同一個 commit 上重跑第二次 15 分鐘的驗證，也不會刪
掉 `node_modules` 再驗一次。在這之前，「驗證通過」在別人機器上不保證是同一套東西。

### ForgeFlowV2 要分成兩半評，它們的成效差很多

**Story + acceptance criteria 這半已經兌現，就在 DBCLI-014／015 的審查裡。** 開 PR
前的雙軸審查抓到三件事：R2 只是註解裡的一次手測而不是會再跑的斷言、R3 用「乘三倍
推估 runner」冒充量測、`.gitignore` 的驗收從 `git check-ignore` 被換成字串比對。
三件全部是拿 diff 對照 `acceptance.md` 逐條比出來的——審查的指令就是「每條發現都
要引用 spec 的那一行」。

沒有 acceptance.md，這三件不會被發現。它們都是「看起來做完了、測試也綠了」的形
狀，正是 agent 交付最典型的失效模式：宣稱寫在散文裡，沒有東西對帳。一份寫在實作
之前、逐條可查的完成定義，是唯一能把這種宣稱擋下來的東西，而它擋下了。`make
verify` 作為 canonical gate、以及「不得為了拿 PASS 而刪測試或放寬驗收」這條規則，
屬於同一半。

**handoff 的 lifecycle 簿記這半還沒兌現。** 五百多行敘事、`completed_stories` 對
帳、baseline 區塊——它到目前為止擋下的是**紀錄本身的錯**（協議裡不存在的
`next_story: none`、CI 淺複製讓對帳靜默通過），不是程式的錯。

差別在消費的時點：acceptance criteria 當下就會被讀（審查時逐條對照），handoff 敘
事是未來才可能被讀。前者已經證明有效，後者是押注。

順帶澄清一個容易誤記的因果：`docs/adr/` 的 24 份 ADR 從 2026-08-04 就開始寫，早
於 ForgeFlow 導入一個月。它不是這套流程帶來的。

### 已經量到的成本

一輪 `make verify` 15 分鐘；FAIL 不留 log，診斷一次要整套重跑（付過一次）；
`review approve` 也要求乾淨工作樹，平行的未提交工作只能 `git stash`；交付紀錄的
回歸——記下驗證結果就產生新 commit，該 Evidence 立刻 stale。

### 判斷

繼續用，但知道每一塊各自在買什麼。ForgePilot 與 acceptance criteria 都已經兌現，
不用猶豫。只有 handoff 的敘事簿記是押注，不是已經兌現的收益。

**Falsified if:** 到 2026-12-08 為止，沒有任何一次決定是因為讀了 `specs/handoff.md`
的敘事段落而改變的。屆時那部分就是在給自己寫沒人看的報告，應該砍到只剩對帳 gate
（`scripts/check-forgeflow-handoff.ts`、`scripts/check-forgeflow-adoption.ts`）與
Lifecycle 區塊，它們擋的是可查證的東西，成本也只有一次 CI。

這條失效條件刻意不涵蓋 `specs/stories/*/acceptance.md`，也不涵蓋 `docs/adr/`。前者
的成效已經量到，不需要再賭；後者早於這套流程存在，用它來評 ForgeFlow 會把因果記
錯。

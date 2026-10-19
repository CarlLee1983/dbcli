# 移除專案對 ForgePilot 的使用要求

## Goal

本專案停止使用 ForgePilot 選擇工作、排程、管理進度與接收驗證證據。
保留 Warrant 的人工核准 Story、範圍限制、逐項驗收與 Human Review，
並維持 `make verify` 為唯一 canonical verification。

本 Story 以 `6d47e9e5365bf6ecff599eb54dab9e19fa9d9eea` 為起點，涵蓋
PR #249 引入的工作流程文件。實作範圍是現行工程指引及其必要契約測試：

- 更新 `AGENTS.md`、`docs/development/agent-workflow.md`、
  `specs/stories/README.md` 與 `README.md` 的 Governance，讓人直接選定
  Story，依需要記錄工作順序，不再要求 ForgePilot 或替代排程系統。
- 更新 `CONTEXT.md`、`docs/development/verification-progress.md`、
  `CONTRIBUTING.md` 及 `docs/development/release-evidence/README.md` 中仍將
  ForgePilot 當成現行操作或證據權威的敘述。其他現行指引如有同樣要求，
  一併移除該要求；歷史引用適用下方保留規則。
- 乾淨且已提交的候選沿用實際 checkout revision 的 CI 與 PR review 證據。
  未提交候選直接執行 `make verify`，在同一份交接紀錄保留 base revision、
  完整候選 diff、相關新增檔的清單與可重建內容、內容雜湊、命令輸出及
  逐項驗收觀察。驗證前後比對候選內容，Human Review 對應同一候選。
  僅有 HEAD 與 `dirty_worktree` 標記不足以識別候選；候選改變後須重新
  驗證及審查。交接可保留為本機文件，未授權提交時不要求 WIP commit。
- 保留現有 attestation 格式、產生流程及 CI 上傳。它仍是單次驗證的紀錄，
  不增加 Story、排程或人工核准欄位。
- 以 ADR-0051 記錄本決策，明確取代 ADR-0040 中保留 ForgePilot 控制平面
  的部分；ADR-0040 的 Warrant 決策與 ADR-0026、ADR-0033 的 attestation
  邊界持續有效。舊 ADR 只可增加必要的狀態或取代關係註記，保留原文。

## Out of Scope

- 改動 dbcli 產品功能、公共 API、套件依賴、版本或資料庫行為。
- 改動 Warrant 的核准標準、驗收條件與人工審查要求；削弱或略過
  `make verify` 的既有關卡、失敗傳遞或 release 的驗證／發布順序。
- 建立替代 ForgePilot 的 CLI、服務、排程器、證據資料庫或自動快照系統。
- 刪除或改寫既有 Story、`specs/handoff.md`、`SCENARIO-MAP.md`、
  dated review、release evidence 與 ADR 正文中的歷史紀錄。
- 刪除、搬移、修改或匯入本機 `.forgepilot/` 資料；移除其 Git 忽略規則；
  卸載全域 ForgePilot 工具或技能。
- 修改其他未提交工作，包括既有 `.scratch/` 與
  `specs/stories/csv-serializes-objects-and-dates.md`。
- commit、push、merge、tag、發布及任何替使用者提交人工審查決定的操作。

## Acceptance Criteria

1. 檢視 `AGENTS.md`、`docs/development/agent-workflow.md`、
   `specs/stories/README.md` 與 README Governance，可確認選工作、驗證、
   交接及人工審查均不要求執行 ForgePilot；Warrant、`make verify` 與
   人工審查同一候選的要求仍明確存在。
2. `docs/development/agent-workflow.md` 說明已提交與未提交候選的證據路徑，
   未提交路徑包含 Goal 所列的候選內容、可重建性、驗證前後比對及審查綁定；
   無需提交 WIP commit、執行 ForgePilot 或新增替代工具。
3. 搜尋受版本控制的 ForgePilot 引用並逐項分類，現行操作／證據指引沒有
   剩餘依賴；允許歷史紀錄、退役說明、忽略規則及防止依賴回流的測試引用。
   完成報告列出仍保留引用的分類與代表位置。
4. 比對起點，`Makefile` 的驗證命令、`scripts/write-attestation.ts`、
   `scripts/lib/verification-attestation.ts`、CI attestation 上傳及 release
   驗證／發布機制保持不變。既有驗證步驟、失敗傳遞、attestation 與
   套件隔離測試仍執行，不因檔名含 ForgePilot 而移除測試。
5. ADR-0051 明確記錄移除範圍、人工候選證據的取捨、仍有效的 Warrant 與
   attestation 決策；ADR-0040 有清楚的部分取代註記。比對起點確認既有
   歷史文件正文未改寫。
6. `git check-ignore .forgepilot/state.json` 成功；差異檢視確認沒有修改
   `.forgepilot/` 資料、全域工具／技能或無關的未提交檔案。
7. 對實作後的確切候選執行 `make verify`，退出碼為 0，且每個條件都有
   命令與結果或所檢視的 `file:line`。通過後交付 Human Review；尚未
   通過或缺少觀察時回報 partial，不能宣稱完成。

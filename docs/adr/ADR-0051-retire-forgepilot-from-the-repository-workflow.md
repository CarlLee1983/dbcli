# 停止使用 ForgePilot 管理專案工作流程

* Status: accepted
* Date: 2026-10-19

使用者已確認停止以 ForgePilot 選工作、排程、管理進度與接收驗證證據，
保留 Warrant、`make verify`、attestation、人工審查、歷史紀錄與本機資料。
本決策與下述未提交候選的證據方式已隨
[Story](../../specs/stories/remove-forgepilot.md) 由使用者於本次工作階段核准。

移除後由人直接選定 Story。已提交候選沿用實際 checkout revision 的 CI
及 PR review；未提交候選以同一份交接紀錄保存 base revision、完整 diff、
相關新增檔的可重建內容及內容雜湊、驗證輸出與驗收觀察，並比對驗證前後
候選內容。人工審查必須對應同一候選。attestation 的 HEAD 與 dirty 標記
不能單獨證明未提交候選的內容。

這省去 ForgePilot 的排程與證據帳本依賴，代價是交接者必須自行保存完整
候選證據。強制先 commit 會排除未授權提交的工作；建立替代快照服務則
重新引入本次要移除的工具維護責任，因此採用人工證據交接。

本決策只取代 ADR-0040 中「ForgePilot stays the control plane」及
相關的必要證據消費者假設；保留其 Warrant 決策。ADR-0026、ADR-0033
的 attestation 格式邊界與失敗步驟紀錄仍有效，CI 持續保存 attestation。
舊 Story、handoff、ADR 正文與既有 release evidence 保留為歷史紀錄。

本機 `.forgepilot/` 保留並繼續被 Git 忽略，全域工具與技能不變。
回復使用 ForgePilot 是工作流程政策變更，不需資料遷移；舊證據不能用來
證明後來改變的候選已通過驗證或審查。

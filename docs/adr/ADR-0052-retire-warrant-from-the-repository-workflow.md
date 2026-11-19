# 停止使用 Warrant 管理專案工作流程

* Status: accepted
* Date: 2026-11-19

Warrant 將日常開發綁定到核准的 Story、逐項驗收及人工審查；ADR-0051
又要求未提交候選保存可重建內容與同一候選的驗證、審查證據。使用者已
明確決定移除這套日常流程，改由直接指派工作、執行驗證並回報結果，
避免每次修改都承擔規格與證據交接的維護成本。

## 決策

日常開發從使用者明確交付的任務開始，不再要求 Warrant Story、Story
核准程序或另一套工作協定。範圍不明且會實質影響結果時再釐清。
`make verify` 仍是標準驗證入口，既有 gates 保留；完成時回報變更、
實際驗證結果與未驗證事項，不再例行要求候選重建紀錄或以人工審查
作為每件任務的完成門檻。使用者要求的審查仍須完成。

發布仍依 [CONTRIBUTING 的發布前檢查清單](../../CONTRIBUTING.md#pre-release-checklist)
保存候選、驗證、審查及發布證據；本次不降低發布要求。Commit、push、
merge、tag 與 publication 仍各自需要使用者授權。ADR-0026、ADR-0033
的 attestation 格式與失敗步驟紀錄不變。

本決策取代 [ADR-0040](ADR-0040-replace-forgeflow-with-warrant.md) 的
Warrant 工作流程，並部分取代
[ADR-0051](ADR-0051-retire-forgepilot-from-the-repository-workflow.md)
對日常工作的 Story、候選重建與必要人工審查要求。ForgeFlow 與 ForgePilot
維持退役，不引入替代排程工具或協定。舊 Story、handoff、ADR 正文、
release evidence 及既有測試引用保留為歷史資料，不是待辦佇列或現行
流程要求。

代價是日常工作不再有統一 Story 格式與逐候選審查紀錄；任務邊界由
使用者指派與必要釐清維持，結果由實際驗證與正常完成回報呈現。

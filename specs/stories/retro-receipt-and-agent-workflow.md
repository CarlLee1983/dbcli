# Story: 修復 assertion receipt 並降低 agent 工作流程成本

狀態：使用者已核准本文，實作中。
基準：G4 已核准 snapshot `8f2ab9a8149067bed96b3d0256107ef6fdd83ce6`。

## Goal

實際執行 `assert --expect ... --evidence-receipt` 可產生有效且不含查詢／結果秘密的 receipt；
失敗測試必須證明預定失敗邊界。讓 agent 在未獲 commit 授權時能明確使用 snapshot，
以精簡進度觀察完整驗證，並減少與當前任務無關的常駐指引與設定輸出。

## Scope

1. 在 assertion 命令交付 receipt builder 的邊界投影最小 pass bits，保留 builder
   的嚴格驗證與既有 receipt schema。補真實 CLI 成功與失敗整合測試；更新 G3 的
   executing-receipt 觀察為修復後成功，保留 grant secret absence 檢查。
2. 修正 repo AGENTS.md 的 commit-only 指引：未獲 commit 授權時使用 ForgePilot
   snapshot；提交需既有明確授權。驗證操作細節指向現有 ForgePilot skill／help，
   不複製完整指令規格；保留 canonical make verify 與 Human Review。
3. 新增 repository operator script，唯讀觀察指定的 make verify log，輸出步驟開始／
   結束、耗時與 PASS／FAIL 證據；提供有限單次摘要與可中斷 follow。重用既有 marker，
   不重新執行 gate、不改 gate、不把 log EOF／暫無輸出誤認為成功。
4. 合併 repo AGENTS 的重複 Graft 指引；將完整前端範例移至按需讀取的 repo 參考文件，
   保留原有 Bun 要求與可達導覽。設定檢查採只讀取相關欄位的方法，不新增全域重複規則。

## Out of Scope

- receipt schema 放寬、加入 SQL／原始結果值、新權限或 RDS CALL 放行。
- 更改 canonical gates、跳過測試、只因文件變更就宣稱沿用另一 revision 的驗證。
- 更改 ForgePilot 本體、全域 hooks／sandbox／model 設定、加入新的 CI 或依賴。
- 改寫 G2～G4 已核准的歷史證據；原始報告保留為當時觀察，以新報告說明修復。
- 提交、推送、發 PR、修改 issue、清理無關未提交檔案。

## Acceptance Criteria

| ID | 可觀察結果 | 驗證 |
| --- | --- | --- |
| AC-01 | 真實 assert --expect 的成功結果可寫入 workspace 內有效 receipt。 | 新增先失敗後通過的 CLI 整合案例：exit 0、receipt 存在、以正式 parser 解析；內容不含 SQL、結果值或合成秘密。 |
| AC-02 | assertion 與 receipt 寫入結果仍各自正確，安全拒絕不能被其他錯誤假冒。 | failed assertion／--no-fail 保持既有退出契約；合法路徑成功作為對照，非法路徑仍拒絕；builder 拒絕額外 checks 欄位的測試保留。追查其他 builder 呼叫點。 |
| AC-03 | G3 grant 去敏與新 executing receipt 同時成立。 | 更新既有整合測試，成功 artifact 可解析且無 auth sentinel；保留 query／export／shell／audit 的安全斷言。歷史報告不改寫。 |
| AC-04 | snapshot 與 commit 授權指引一致；按需導覽有效。 | 檢查 AGENTS 無 commit-only 要求、無重複 Graft 操作清單；前端參考內容保留且連結存在；新只讀 agent/session 能正確辨認驗證與授權規則。 |
| AC-05 | 進度工具不冒報成功，輸出有界且無重複事件。 | 以合成 log 驗證進行中、成功、失敗、部分行與追加內容；缺少 final attestation 維持未知／進行中；不輸出完整測試或原始資料內容。使用於本次 canonical 驗證。 |
| AC-06 | 使用者文件與交付證據完整。 | 更新雙語 index.md／index.html 與 changelog 的 receipt 說明；獨立審查無重大問題；完整 make verify 與 ForgePilot snapshot PASS，逐項報告後等待 Human Review。 |

## 風險與回復

receipt 只投影布林結果，不放寬資料接受面；既有 G3 測試對錯誤的期待須隨修復更新。
進度工具只供觀察，實際 verdict 仍以 canonical 命令退出狀態與 ForgePilot evidence 為準。
工具失效可直接讀原 log；指引回復只還原本次差異。無新增依賴或資料遷移。

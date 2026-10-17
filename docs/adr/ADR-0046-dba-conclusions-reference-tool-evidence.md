# DBA 工作結論引用工具證據，採用獨立結果模型

* Status: accepted
* Date: 2026-10-17
* Decision: [#234](https://github.com/CarlLee1983/dbcli/issues/234)，於本次設計訪談確認。

延續 [ADR-0045](ADR-0045-the-dba-role-skill-lives-outside-dbcli.md)，`dba-skill`
擁有自己的工作流程結果模型，引用 dbcli、AWS 與人工演練證據。
dbcli 命令成功不代表 DBA 主張成立；把跨工具結論放入 dbcli operation envelope
會讓 Role Skill 的判斷進入 Tool 的公開契約，因此不採用延伸 envelope 的方案。

## 主張與範圍

每次評估事先固定必要主張、對象、環境、時間、適用條件與最低證據要求，不能為了
通過而縮小範圍。「備份存在」「演練驗證可還原」「符合 RPO」「符合 RTO」分別判定，
前一項成立不使後一項自動成立。RPO／RTO 必須有目標值；未提供時可以報量測值，
不能判定達標。昨天的隔離演練只支持該次備份、環境與條件下的結論。

各工作流程規格定義判定規則、必要證據與時效條件。例如可還原主張需要隔離演練
紀錄與還原後驗證，備份清單或一句「完成了」不足以證成。

## 主張結果

| 結果 | 語意 |
| --- | --- |
| `met` | 充分且符合判定規則的證據支持主張，沒有未解決的相關矛盾。 |
| `not-met` | 充分且符合判定規則的證據顯示主張不符合，沒有未解決的相關矛盾。 |
| `blocked` | 證據不足，必要步驟因 dbcli capability 不可用或等待人工批准／執行而受阻。 |
| `indeterminate` | 證據不足或矛盾，無法判定；包含缺少平台資訊、AWS CLI 或唯讀 IAM 前置條件。 |

判定順序：先看是否有充分且無相關矛盾的證據可判為 `met`／`not-met`；否則，
有未解決的證據矛盾為 `indeterminate`；必要步驟受阻為 `blocked`；其餘不足為
`indeterminate`。缺少 AWS CLI／唯讀 IAM 明確歸為 `indeterminate`。
充分證據已確認不符合時，輔助查詢受阻不掩蓋 `not-met`，仍附列該缺口。
此順序不豁免 ADR-0045 的 capability 前置檢查或版本不符停止規則，也不授予執行權限。

等待批准與等待執行分別記錄原因、解除條件及交接對象；執行後缺少可判讀證據為
`indeterminate`。批准紀錄本身不是演練成功證據；批准格式由
[#236](https://github.com/CarlLee1983/dbcli/issues/236) 定義。

範圍外主張標「本次未評估」，不是第五種判定，也不算成功。摘要列四種結果數量、
未符合主張與待補證據，不以單一狀態優先序壓平混合結果。只有全部必要主張為
`met`，才可宣稱「本次範圍內全部符合」。

## 證據與歷史

工作流程結果引用原始證據並保留其語意，不把 receipt 的 `succeeded` 自動轉成
`met`，也不要求所有觀察都必須有 receipt。既有 receipt 的操作集合不含 query；
receipt 是可選產物，命令成功也不保證保存成功。

每筆證據記錄來源種類、取得時間、對象／環境、可追溯位置，以及可取得時的來源 ID。
保存成檔案的證據另記內容雜湊；雜湊只檢查內容是否改變，不保證真實性、批准或
判斷正確。敏感原始資料不直接嵌入結果，引用受控保存的證據。

必要證據保存失敗且無其他符合要求的證據可供判讀時，該主張為 `indeterminate`。
保留歷史結論及當時適用範圍，另記目前證據是否可取得、完整且符合時效。
再次評估產生新結果；必要證據已不可用或不符時效且無合格替代證據時，新的主張
結果為 `indeterminate`，不覆寫舊紀錄或把歷史成功改成歷史失敗。

## 最低資訊與後續邊界

結果包含模型版本、評估識別、範圍、各主張結果、判定理由、證據引用、缺口與交接資訊。
結果模型版本與 dbcli capability contract 版本分開管理。
精確欄位名稱、檔案格式、產生／保存方式及驗證方式交由後續 Warrant Story 規格化。
本決策不新增 CLI、儲存服務或 JSON validator，也不修改 dbcli 的既有狀態與 envelope。

既有契約依據：

- [Evidence receipt](../../src/core/evidence-receipt/index.ts)：操作結果與受限觀測。
- [Operation envelope](../../src/core/operation-envelope.ts)：有限命令回應，非 DBA 工作結論。
- [術語](../../CONTEXT.md)：工具、驗證與 DBA 工作結論分層。

此決策的邊界若被破壞，例如把 DBA 四種結果加入 dbcli envelope，或把命令成功直接
當成必要主張成立，就必須重新審視此 ADR；不能視為一般格式調整。

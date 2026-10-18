# SHOW GRANTS 的認證內容在 adapter 回傳前去敏

* Status: accepted
* Date: 2026-10-18

G3 在 MySQL／MariaDB 共用 adapter 的正常與 native-read-only 結果邊界處理 SHOW GRANTS，
因為 query、shell、匯出與直接 adapter 呼叫沒有共同的命令層或 formatter 路徑。
可辨識的認證 payload 改為明確遮罩標記，保留授權判讀資訊；未知或歧義格式整格省略，
不採原文 fallback。保護對所有權限與執行模式生效，不依賴 blacklist，也不提供 bypass。

相較於新建結構化權限模型，此方案保留既有列／欄位形狀；代價是輸出不再是可重播的
原始 SQL，且未知格式可能失去該列的授權細節。只在 formatter 去敏會漏掉其他消費端，
在每個命令分別處理則容易產生未受保護的新路徑。本次只保護 SHOW GRANTS，不宣稱
SHOW CREATE USER、直接系統表查詢或任意秘密文字也受保護。

本決策與 [G3 Story](../../specs/stories/grant-authentication-redaction.md) 已由使用者核准。
GATE-002 另核准重用既有連線版本資訊，版本未知且語句有歧義時以固定錯誤拒絕，不另作 probe。
沒有資料遷移；撤回去敏會恢復認證內容的可見性，安全的降級方式是整格省略。

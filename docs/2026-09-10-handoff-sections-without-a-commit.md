# 沒有 commit 可以承接的 handoff 段落

DBCLI-033 把已交付 Story 的交付敘事移出 `specs/handoff.md`，理由是那些理由更完整地
寫在交付它的 commit body 裡。移除的許可是那個 commit body 至少八行。

這一段沒有那張許可：`DBCLI-PLAT-007` 的交付 commit（`3d1db4f6ab`）body 只有一行
`Story: DBCLI-PLAT-007`，所以下面這段文字是它現存最完整的紀錄。原樣保留在這裡，而
不是刪掉，也不是留在 handoff 裡讓那條規則反覆對它報錯。

決定在 ADR-0036。

## DBCLI-PLAT-007 與 issue #150 收尾

DBCLI-PLAT-007 的既有實作已補齊七個 receipt 指令的失敗路徑；各指令會在原本的
exit 或 throw 前完成要求的 failed receipt，並保留原輸出、exit code 與 schema
early-exit 的 audit 行為。整合測試以實際 command rows、credential、connection URI、
SQL、error、session ID、absolute path 與 stdout payload 驗證八個指定值都不會寫進
receipt，也涵蓋無 correlation、非覆寫路徑與固定寫入失敗訊息。

Issue #150 已以 `tests/unit/core/semantic/semantic.test.ts` 釘住 semantic context 的
版本邊界：v1、v2 合法，v3、字串 `"2"`、缺版本與 v1 migration 以外的來源均拒絕。
本次 `make verify` 通過 6,757 tests、0 failures。

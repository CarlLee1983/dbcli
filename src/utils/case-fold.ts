/**
 * 名稱比對用的大小寫折疊——整串折與逐字折會得到同一個答案。
 *
 * `String.prototype.toLowerCase` 實作 Unicode 的預設大小寫轉換，其中
 * `Final_Sigma` 是唯一一條**看上下文**的規則：`Σ` 前面是字母、後面不是字母時
 * 折成 `ς`，其餘位置折成 `σ`。於是同一個字元整串折與逐字折的結果不同，而黑名單
 * 的兩側剛好各折一種——`foldFieldPath` 折整串、`globMatches` 折每個字元——規則
 * `ΑΣ*` 指名的欄位 `ΑΣ_num` 因此比不上，原文回傳。
 *
 * 把 `ς` 併回 `σ` 讓折疊不再看上下文，兩側才可能是同一套規則。代價與 ADR-0020
 * 選的方向一致：一份文件同時有 `ς` 與 `σ` 結尾的兩個欄位時，指名其一的規則兩個
 * 都遮。過度拒絕可以用更精確的規則收回來；反過來沒有任何東西會告訴你它發生過。
 *
 * `İ`（U+0130）折成 `i` 而不是 `toLowerCase` 給的 `i` + U+0307：折疊必須**保長**。
 * `globMatches` 的 `?` 與每個 `*`-free 區段都是固定寬度的窗口，一個字元折成兩個
 * 碼元會讓窗口永遠對不齊——規則 `secret?` 因此擋不住表格 `secretİ`，而
 * `isTableBlacklisted` 是強制擋下查詢的檢查，不是顯示過濾。掃過
 * U+0000–U+2FFFF 驗證：加上這一條之後沒有任何碼位的折疊會改變長度。
 *
 * 映成 `i` 也是土耳其文的實際大小寫關係（`İ` 就是 `i` 的大寫），代價同上：規則
 * 寫 `İ` 會連 `i` 一起遮。
 */
export function foldCase(text: string): string {
  // `İ` 要在 `toLowerCase` 之前換掉，否則它已經變成兩個碼元了。
  const lowered = (text.includes('İ') ? text.replaceAll('İ', 'i') : text).toLowerCase()
  // 這個函式在每一次區段比對上都跑一遍，而這兩個字元在欄位名裡幾乎不會出現：
  // 先問一次再決定要不要跑 replace，比每次都建一個結果字串便宜。
  return lowered.includes('ς') ? lowered.replaceAll('ς', 'σ') : lowered
}

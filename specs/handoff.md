# ForgeFlow Handoff

十二個 Story 全數交付，已於 PR #144 合併進 `main`（merge commit `04a88a44`），
合併後的收尾為 PR #145（`a2a05cc2`）。DBCLI-013 已交付，收的是 ForgeFlow 導入本身的尾——
採用版本的對帳、發布前的盤點，以及把仍留在這份散文裡的風險移出去。那一批結束時
沒有已知的產品缺口。

之後開的是 Agent Platform 這條線：DBCLI-PLAT-001、011、012、013 已交付並合併進
`main`（PR #152、#164、#163、#162）。DBCLI-PLAT-004 Operation Envelope v1 的
Story 與驗收規格已核准，現在是 current Story；下一個明定為 DBCLI-PLAT-005。

未結的是發布：DBCLI-001 到 012 的成果全部未發布，建議版本 8.0.0，留給下一個獨立的
release Story。bump 之前 `SECURITY.md` 的支援列必須從 `7.x` 改成 `8.x`，否則
`manifest:check`（`scripts/check-plugin-manifests.ts:164-176`）會擋下 release。

## 已交付：DBCLI-PLAT-001

Agent Integration Contract v1 的第一個垂直切片，已由 PR #152 合併進 `main`
（merge commit `9719eb49`），其後的 CI 修正是 PR #153（`c3e701a1`）。
`dbcli capabilities` 與 `dbcli capabilities check` 讓外部 Skill 在動工前問得到
「這個工具能做什麼」、「這裡有沒有」，兩者都不建立資料庫連線。設計記錄在
`docs/specs/2026-09-04-agent-integration-contract-v1.md`，決定在 ADR-0022。

這個 Story 最值得留下的一句：**contract 說謊了五次，沒有一次是讀碼看出來的。**
缺設定時拿 `DEFAULT_CONFIG` 的 localhost PostgreSQL 當真實環境回報；手寫的
`supportsJson` 四個指令是錯的；v2 預設連線的 `connectionName` 回 null；agent mode
下對 `connection.select` 回 `available`；一個裸 catch 把五種狀況壓成同一句假話。
前三個是測試與探測抓到的，後兩個是 code review 抓到的。

其中 agent mode 那個最值得記住。原本的辯護是 ADR 寫的「available 不是核准」，
但那條免責聲明蓋不住它——差別在**拒絕是何時決定的**：blacklist 與人類同意在執行
當下決定，契約無從代言；`DBCLI_AGENT_MODE=1` 在這裡就決定了，而且不連線就完全可知。
對著這份契約的主要客群（agent）宣稱一件下一個指令就會推翻的事，是這份契約唯一
會被真正依賴的假承諾。

留下一個已知的過度宣稱，寫進 ADR 與 acceptance：`dbcli schema` 會把讀到的 schema
持久化進 `config.json`，那個寫入也在 agent mode 的閘門後面，所以 `schema.read`
在 agent mode 下回 `available` 但實際跑會在持久化那步失敗。標成 unavailable 會讓
agent 以為完全讀不到 schema，反方向的錯更大。真正的修法是 schema *快取*的寫入
本來就不該擋在「連線身分」的閘門後面：DBCLI-PLAT-012。

已知邊界，不是疏漏（**DBCLI-PLAT-011 已關閉**，catalog 從 34 條增為 53
條）：`ENGINE_CAPABILITIES` 只涵蓋 34 個 command key，dbcli 有 50 個
top-level 指令。`explain`、`plan`、`impact`、`assert`、`verify`、`evidence` 等 16 個
不在 catalog 裡，問它們會得到 `unknown`。替它們寫 engine 支援度等於憑讀碼捏造未經
稽核的宣稱，這正是這份契約要避免的事。擴充 matrix 是 DBCLI-PLAT-011。

後續 backlog（DBCLI-PLAT-004 到 011）只寫進 spec，沒有實作。Task Pack 仍是
`plan-only`，`safety.requires` 沒有動。

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

## 已交付：DBCLI-PLAT-013——契約與交接的收尾

三件事，同一個形狀：一句寫下來的宣稱，沒有任何東西拿它跟 repository 對帳。

**`--require` 的順序語意有兩個答案。** PLAT-001 的 `story.md` R5 寫著輸出
「independent of `--require` argument order」，`acceptance.md` 也照著勾了。實作
從第一天起就在 `required` 與 `results` 保留 first-seen 輸入順序，它自己的單元
測試逐字斷言這件事，設計記錄從來沒有講過另一句。所以四個表面裡有兩個宣告了
一個沒有人實作、也沒有人測過的性質。

窄的那個性質才是要的：`results[i]` 回答 `required[i]`。把 `results` 排序會讓
呼叫端失去自己送出去那份清單的對應關係，得再用 id 重新索引一次才讀得懂自己的
答案。所以正式語意是三條分開的話——相同輸入 byte-identical、兩個清單保留
first-seen 順序、換順序不改變任何判決與 `ok`——並以
`tests/docs/capability-ordering-parity.test.ts` 綁住八個表面。

這一條值得記住的不是結論，是它怎麼活下來的：那個勾是對著一支**真的存在**的測試
勾的，測試證明的是判決與順序無關，而它上面那句話長大了。沒有東西讀散文，於是
散文可以說任何話。

**交接紀錄還說 PLAT-001 在進行中。** `baseline.branch` 指著一個已合併並刪除的
feature branch，`verification` 還寫著 `release:check` 沒跑完。寫下來的當時全部
為真，現在全部不是。這正是 `check-forgeflow-handoff.ts` 存在的理由，而它剛好
看不到這一格。

**delivery gate 讀不到 PLAT 的 Story ID。** 舊版用
`/^(DBCLI-\d+).*$/` 從目錄名推出 ID。`DBCLI-PLAT-001-capability-contract` 不匹配，
`String.replace` 原樣回傳，Story 於是被鍵在自己的完整目錄名底下——把
`DBCLI-PLAT-001` 加進 `completed_stories` 會得到「has no specs/stories directory」，
一句聽起來為真、指著一個明明存在的目錄的錯誤訊息。

把 regex 放寬只買到一個 ID family，下一個又會用同樣安靜的方式壞掉。所以改成
不認任何 ID 形狀：每份 `story.md` 的 `# Story: <ID>` 標題本來就宣告了自己的 ID，
gate 去讀它。仍然比對的只有一件事——宣告的 ID 必須是目錄名的前綴。一個 Story
有兩個互相矛盾的名字，比只有一個壞名字更糟：交接紀錄引用其中一個，翻目錄的人
看到另一個，而兩邊都不夠錯到會被發現。

規則搬進 `scripts/lib/forgeflow-handoff.ts`，跟著 `check-forgeflow-adoption.ts`
的 lib/shell 切法。這樣切有兩個收穫：規則可以對 fixture 測，不必對一個每交付
一個 Story 就換答案的 repository 測；而且那個檔案不 import 任何東西，於是
「這個 gate 不碰網路」從 header 裡的一句承諾變成檔案本身的性質——一支測試直接
斷言它沒有 import。

順帶補上一條新規則：同一個 Story 不能同時出現在 `current_story` 與
`completed_stories`。兩者只有一個為真，另一個是沒人刪掉的舊行，而兩行併在一起
什麼都沒說。

shallow clone 仍然拒絕驗證，而且「既不是 true 也不是 false」的回答也拒絕：把
讀不懂的答案當成「不是 shallow」，就是在證據缺席時假設證據沒事，正是這個 gate
存在要防的事。

## 已交付：DBCLI-PLAT-012——schema cache 的寫入邊界

PLAT-001 交付時記下的那個已知過度宣稱，起因已經移除：`DBCLI_AGENT_MODE=1` 下
`capabilities check` 說 `schema.read` 可用，`dbcli schema` 卻 exit 1。

這個 Story 最值得留下的一句：**真正的缺陷不是 guard 放錯位置，是快取更新根本是一次
完整設定的重新發布，只是掛著快取的名字。**

原本的辯護是「schema cache 存在 `config.json` 裡，所以擋在設定的閘門後面」。動手
之前先量了一次：對一份 `connection.password: "testpass"`、`.env.local` 寫著
`DB_PASSWORD=untouched` 的設定跑一次 schema 寫入，結果是密碼被從 `config.json`
刪掉、`.env.local` 被整份覆寫成新產生的 `DBCLI_PASSWORD=testpass`。這件事**在
agent mode 之外也會發生**——那裡沒有任何 guard 會攔。所以那個 guard 不是防線，
它只是唯一會對這個行為出聲的東西，而且出的還是錯的聲。

修法刻意不是替 guard 開一個例外。一個「這次寫入沒問題」的布林參數，等於把邊界交給
呼叫端記得誠實；guard 保護的就會變成「大家有沒有老實申報」。
`src/core/schema-cache-persistence.ts` 的窄化在**簽章**：參數只有 schema、
connection slot 與兩個時間戳，設定是它自己從磁碟讀的，沒有任何一條路徑能讓憑證、
權限或 host 通過。寫不出來的東西不需要被批准。

`assertOnlyCacheFieldsChanged` 把同一句保證講出來。它對今天的程式是多餘的——這正是
重點：任何擴大寫入範圍的修改會在單元測試裡指名欄位而失敗，而不是上線。

`assertConfigMutationApproved()` 一個字都沒改。六個 guarded writer 一個都沒少，並由
`tests/contract/config-mutation-boundary.test.ts` 以名冊釘住兩個方向：清單裡的都要
guard，清單外的都不准 guard。名冊的比對只讀程式碼、不讀註解——seam 與 schema 指令的
檔頭都在**討論**這個 guard，把提及算成呼叫的檢查只能靠刪掉解釋來滿足。

還有一件事是新的：契約與行為現在綁在同一支測試裡。
`tests/integration/schema-cache-agent-mode.test.ts` 先問 `capabilities check`、
再跑 `dbcli schema`，對真的 PostgreSQL。PLAT-001 的過度宣稱能活下來，就是因為沒有
任何東西同時問過這兩件事。

`INCIDENTAL_CONFIG_WRITERS` 因此清空。它留在原地而不是刪掉：再加回一筆應該是一個
決定，不是一次重構。

過程中撞到、確認為既有且範圍外的一件事：agent mode 下，設定若是透過 symlink 路徑
（macOS 的 `/var/folders` 對 `/private/var/folders`）讀到，完整性紀錄的 `targetPath`
會對不上而被判成 tampering。整合測試用 `realpath` 迴避，原因寫在測試裡。

## DBCLI-PLAT-011：完整的 Capability Matrix

Catalog 從 34 條增為 53 條，涵蓋所有公開指令。

這個 Story 最值得留下的一句：**四個 subagent 平行去稽核那十六個指令，沒有一個交回
可用的報告，於是每一條都自己讀。對這個 Story 來說那反而是對的結果——它的整條規則
就是「二手的支援度宣稱正是要防的東西」。**

PLAT-001 把十六個指令留在 catalog 之外是對的：替沒稽核過的指令寫 engine 支援度，
正是這份契約要防的那種捏造。所以這次的規則不是「把表填滿」，是「程式碼判定得了的
就填，判定不了的寫 `unsupported`」。不新增第三種狀態——一個「我們沒查」的值，呼叫端
拿到也不能做任何事，而且會永遠留在那裡沒人查；`unsupported` 用的是呼叫端已經會解析
的詞彙，說的是同一件事：別建在這上面。判定不了的地方寫進 Story，給人看。

六個指令的程式碼會直接拒絕非 SQL 連線，逐條指名那道 gate（`explain.ts:43`、
`assert.ts:41`、`snapshot.ts:30`、`verify.ts:75`、`proxy.ts:15`，以及 `plan` 的
`toSqlDialect`）。完全不碰資料庫的標 `not-applicable`。

**三條第一版寫錯，被第二個讀者抓回來。** `impact assess`、`design`、`semantic` 原本
也標成 `unsupported`——依據是 grep 到每個指令模組裡的 engine check 然後把它讀了。那
是對的，但少走一步：讀 caller 才看得出那道 check 擋的是**模式**，不是指令。
`--against-cache`（impact/design）與 `draft validate`（semantic）之外的路徑根本不看
連線。改成 `limited`，並在 note 裡指名失去的是哪一個模式。寫成 `unsupported` 會對著
MongoDB 上的 agent 說一個它其實跑得動的指令不能用——fail-closed，所以永遠不會看起來
像錯的，只會讓契約悄悄比工具本身沒用。

`plan` 沒有跟著改，這個不對稱是刻意的：`design` 在非 SQL 上還有 `--against-orm`、
`semantic` 還有 context/search/drift，是真的還有東西可用；`plan` 從頭到尾只有一件事
——評估一段 SQL 的寫入風險——在 Redis 連線上根本沒有 SQL 可評估。`limited` 會承諾一個
不存在的模式。

**contract test 抓到兩件讀碼沒抓到的事**，這是這批工作真正的收穫：

第一，`commandWritesConfig` 用 `commands/<name>.ts` 找檔案，**找不到就跳過**。
`password` 住在 `credential.ts`、`contract` 住在 `contracts.ts`，於是「這個指令不會寫
設定」對著那個專門用來改憑證的指令回了 true，而且是靜悄悄地回。對照表改從
`program-lazy.ts` 的 lazy loader 讀，找不到模組是失敗而不是跳過。一個在證據缺席時
回「通過」的檢查，跟 shallow clone 那件事是同一類。

第二，`impact assess` 與 `design` 的 `requiresConnection: false` 被拒絕了。兩個指令
本身確實離線，但它們從 `commands/diff.ts` import ORM artifact 的讀取工具，於是把
diff 的 adapter import 拖進自己的 static graph。那段程式碼的註解本來就寫著「never
opens a database connection or reads dbcli configuration」——它住在 command 模組裡
只是因為 diff 是第一個需要它的地方。搬到 `src/core/orm-drift/input.ts`，行為一個字
沒改，差別是那個離線宣稱現在證明得出來，而不是被豁免。這是刻意選的：加一條例外
會讓 R4 從此少一個能檢查的東西。

`supportsEvidence` 原本是空集合，因為會寫 receipt 的三個指令都不在 v1 catalog 裡。
現在由 contract test 從指令層的實際 writer 呼叫雙向推導。第一版寫成「import graph
碰得到 evidence 模組」，結果 `insert`、`query`、`schema` 等十七個指令全中——它們只是
遞移拉到型別。碰得到不等於會寫。順帶補上 `recover`：它一直在 catalog 裡，也一直能
用 `--write-verification-artifact` 寫出 artifact，只是沒人對過。

`capabilities` 自己也進 catalog，決定寫在 ADR-0023。反對的理由是真的：live 讀的時候
`capability.check` 只可能是 `available`，是個常數。但 catalog 本來就是設計成可以被
pin 住的——一個帶著舊 catalog 的 Skill 對著沒有這個指令的 dbcli 問
`--require capability.check`，會拿到 `unknown-capability`，那正是它需要的訊號。而且
「所有公開指令都被描述」是個能檢查的規則，「除了負責描述的那一個」是個帶例外的規則，
沒寫下來的例外會被反覆重新爭論。

三支既有測試刻意改動：`mutatesConfiguration` 名冊加入
`connection.rotate-credential`；兩支憑證洩漏檢查原本比對裸字 `password`，而它現在是
一個指令路徑——unit 版只豁免 `command` 欄位，integration 版改比對 `"password":` 這個
JSON key，兩者都沒有為其他欄位放寬。

## Lifecycle

```yaml
workflow:
  current_story: DBCLI-PLAT-004
  next_story: DBCLI-PLAT-005
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
    - DBCLI-013
    - DBCLI-PLAT-001
    - DBCLI-PLAT-011
    - DBCLI-PLAT-012
    - DBCLI-PLAT-013
  status: in_progress

baseline:
  repository: CarlLee1983/dbcli
  branch: main
  commit: 4aa8c183213ccb44bdb03db18351797f3522e13f
  dirty_worktree: true
  story_owned_paths:
    - CONTEXT.md
    - docs/adr/0024-operation-envelopes-use-an-explicit-root-output-mode.md
    - docs/specs/2026-09-04-agent-integration-contract-v1.md
    - specs/stories/DBCLI-PLAT-004-operation-envelope-v1/
    - specs/handoff.md
  known_unrelated_paths: []

verification:
  last_command: bun run format:check && bun run forgeflow:check && git diff --check
  result: pass
  detail: >-
    On this Story-document worktree, make verify passed before the final
    reviewer-only Markdown corrections: 6658 pass / 0 fail across 565 files,
    performance 21 pass / 2 intentional SQL skips / 0 fail, reproducible build,
    and every static gate passed. After the corrections, format:check,
    forgeflow:check, and git diff --check all passed. Product implementation and
    its new acceptance tests have not started. release:check was not run because
    no release was requested.
```

# ForgeFlow Handoff

十二個 Story 全數交付，已於 PR #144 合併進 `main`（merge commit `04a88a44`），
合併後的收尾為 PR #145（`a2a05cc2`）。DBCLI-013 已交付，收的是 ForgeFlow 導入本身的尾——
採用版本的對帳、發布前的盤點，以及把仍留在這份散文裡的風險移出去。那一批結束時
沒有已知的產品缺口。

之後開的是 Agent Platform 這條線：DBCLI-PLAT-001、004 到 010、011、012、013
均已交付並合併進 `main`（PR #152、#162 到 #170）。其中 009、010 以 issue 驗收，
沒有建立正式 ForgeFlow Story。

8.0.0 release diff 將 DBCLI-001 到 012 與 Agent Platform 成果定版，並把
`SECURITY.md` 的支援線從 `7.x` 更新為 `8.x`。`bun run release:check` 已通過；
合併、tag、GitHub Release 與 npm publish 依 release 流程執行。

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

採用 ForgeFlow 0.7.0。權威記錄是 `specs/.forgeflow-adoption`，這裡只是複述，
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

## DBCLI-PLAT-009 — Skill Author Integration Kit

Issue #159 is implemented without a formal ForgeFlow Story. The shipped
`assets/integration-kit/` contains a runnable Bun/TypeScript consumer fixture,
strict public-contract parsing and schema pins, a Task Pack `safety.requires`
example, and correlation/evidence guidance. Its integration test exercises
catalog discovery plus successful and unsuccessful Operation Envelope
preflight against the real CLI. `make verify` passed with 6,744 tests.

## DBCLI-PLAT-007 與 issue #150 收尾

DBCLI-PLAT-007 的既有實作已補齊七個 receipt 指令的失敗路徑；各指令會在原本的
exit 或 throw 前完成要求的 failed receipt，並保留原輸出、exit code 與 schema
early-exit 的 audit 行為。整合測試以實際 command rows、credential、connection URI、
SQL、error、session ID、absolute path 與 stdout payload 驗證八個指定值都不會寫進
receipt，也涵蓋無 correlation、非覆寫路徑與固定寫入失敗訊息。

Issue #150 已以 `tests/unit/core/semantic/semantic.test.ts` 釘住 semantic context 的
版本邊界：v1、v2 合法，v3、字串 `"2"`、缺版本與 v1 migration 以外的來源均拒絕。
本次 `make verify` 通過 6,757 tests、0 failures。

## DBCLI-014：ForgePilot 第一次真的駕駛這個 repository

這個 Story 最值得留下的一句：**`make verify` 從來沒有在乾淨 checkout 上跑過，
而那正是它宣稱自己在說的事。**

ForgePilot 在 `.forgepilot/worktrees/` 建立確切 commit 的 detached worktree，
在裡面執行這個 repository 自己的 `make verify`。第一次動手之前先量了一次：
那個 checkout 沒有 `node_modules`，`format:check` 得到
`prettier: command not found`，`typecheck` 解析到一個從 PATH 來的 `tsc`，
回報的是一個跟這個 repository 無關的 TS5101。

CI 每個 job 前面都有 `bun install --frozen-lockfile`，Makefile 沒有。所以
`make verify` 一直是「在一台已經裝好東西的機器上會通過」，不是「這個 commit
會通過」。差別在 ForgePilot 之前沒有東西會撞到——每個人都在自己的工作樹裡跑它。
補的是 install，不是把哪一步放寬：既有 23 步一步沒刪、順序沒換，並由
`tests/contract/forgepilot-boundary.test.ts` 以名冊釘住。名冊而不是從 Makefile
重算，理由跟 `check-forgeflow-adoption` 一樣——會自己重算清單的檢查對任何清單
都通過。

`--frozen-lockfile` 而不是 `bun install`：解析出一份 `bun.lock` 沒有釘住的
依賴集合，跟找不到 prettier 是同一類錯誤，只是它不會出聲。

整合服務不是問題，這一點事前猜錯過：detached worktree 走的是 host port，
`docker-compose.test.yml` 起的六個服務照樣連得到，`services:check` 在沒有
`node_modules` 的 checkout 裡就通過了——它只用 Bun 內建。

**ForgePilot 是操作工具，不是相依。** 契約測試同時釘住三件事：install 是第一步、
`package.json` 與 `src/` 任何檔案都不提 ForgePilot、`.gitignore` 匹配
`.forgepilot/`。沒裝 ForgePilot 的人 clone 下來 `make verify` 照跑。

順帶在 ForgePilot 自己那邊修掉兩個 install-path 缺陷（記錄在該 repository 的
`0e7030e`、`884144e`）：`go.mod` 宣告的 module path 指向一個不存在的
repository，README 照抄的 `go install` 從來沒成功過；`forgepilot --help` 在
還沒 init 的地方回「run forgepilot init first」，而問有哪些指令的人正是還沒
決定要不要 init 的人。

## DBCLI-015 起草中：同一個 commit 給出兩種答案

DBCLI-014 的驗證跑了三次：EV-001 PASS 在 `aab45382`，EV-002 FAIL 與 EV-003
PASS 都在 `d618f196`。兩次之間 repository 一個字沒改，差別只有機器當下的負載。

失敗的是 `tests/unit/core/blacklist-manager.test.ts` 的
`performance > completes 1000 table lookups in < 10ms`：整套 6,700 支測試一起
跑時量到 21.43 ms，單獨跑那個檔案三次全過。

這比一支慢測試嚴重，因為 `make verify` 是這個 repository 的驗證契約，而
ForgePilot 把它的結果綁在確切 commit 上。一個判決取決於機器的斷言，會讓那個綁定
宣稱它撐不住的事；而且它訓練讀的人重跑而不是細看，真的回歸就是這樣被揮過去的。

怎麼修是人的決定，記在 GATE-002，不在這裡選。兩個選項是搬進 `bun run test:perf`
（那裡的預算依 runner 實測設定並印出量到的值，理由寫在 CI workflow 裡那段四個月
沒人發現的 benchmark 失敗），或改成斷言複雜度而非絕對時間。**放寬常數刻意不是
選項**：它留下同一個 load-dependent 的判決，正是缺陷本身。Story 的 Constraints
把這句話寫死，免得下一個人重新爭論。

Story 已起草但尚未 READY——GATE-002 未解除之前 `forgepilot next` 不會選到它。

## 已交付：DBCLI-015——把載重敏感的判決搬離 unit suite

GATE-002 選的是「搬進 `bun run test:perf`，預算依 runner 實測設定並印出量到的
值」。動手之後那個「搬」揭露了兩件 Story 沒預料到的事。

**目的地早就有一份更大的同一個量測。** `Table lookup (1000 tables)` 一直在
`tests/perf/blacklist-performance.bench.ts` 裡，用 `medianElapsed` 取九次中位數
並印出數字。unit suite 那份是它嚴格較弱的複本：100 張表、單次 `performance.now()`、
不印任何東西。

**典型規模的預算擋不住那個回歸。** 這台機器上，set-backed 查表在 100 張表下
中位數 0.14 ms，而它取代掉的形狀——逐次 case folding 的線性掃描——中位數
0.98 ms。這個檔案把 dev 量測乘以三倍當作 runner 成本，任何寬到不會變成擲硬幣的
預算都落在 0.98 ms 之上。所以典型規模那一條記錄成本，不防守成本。

**大規模那一條的舊預算也擋不住。** 1000 張表量到 0.099 ms，預算 10 ms——量測值的
一百倍——而線性掃描回歸量到 7.67 ms，在這台機器上**低於**舊預算。它只有在慢的
runner 把時間乘三倍之後才會紅。收緊到 2 ms 才讓 R2 成立：離真實量測 6.7 倍，
而回歸在哪裡都會失敗。

兩個規模都留著，斷言數沒有減少。unit suite 原地留一段註解說明預算去哪了，以及
為什麼不要再放一份回來——不然下一個人只會看到一個少掉的測試。

這個 Story 最值得留下的一句：**一個一百倍寬的預算跟沒有預算的差別，只有在你去量
它要擋的那個回歸時才看得出來。** 舊的 10 ms 兩頭落空——它擋不住回歸，卻擋得住
一台忙碌的機器。

審查補上的一件事：上面那句「線性掃描量到 7.67 ms」原本只寫在註解裡，是一次手測
紀錄，不是會再跑的斷言——R2 因此沒有東西守著。現在 `tests/perf/` 多了一對測試，
量同一份查表在 100 與 1000 個表名下的成本比：set 查表約 0.8–1.3，線性掃描約
6–12，門檻取 3。比值沒有單位，慢的 runner 兩邊一起慢，所以它擋的是 R2 講的那個
性質，不是某台機器上的一個毫秒數。第二支測試拿線性掃描跑同一個檢查並要求它超過
門檻——門檻能不能分辨，是量出來的，不是宣稱的。

`.forgepilot/` 的忽略檢查也從比對 `.gitignore` 字串改成問 Git（`git check-ignore`），
acceptance 本來就是這樣寫的：字串在不等於 Git 真的忽略它，後面任何一條反向規則
都能推翻。拿掉那行規則驗過，測試會紅。

DBCLI-014 這次一併進 `completed_stories`。它交付、驗證、Human Review 都過了，
留在清單外只會讓紀錄同時說不出它是進行中還是完成——`status` 仍是 `review`，因為
ForgeFlow 的 DONE 還要求 merge policy，而這條分支尚未合併。

## 收尾：PR #172 合併，以及 R3 的真實 runner 數字

PR #172 於 `dbf2c5d7` 合併進 main，CI 十一個 job 全綠（三個 OS × 兩個 Bun 版本，
外加 format、audit、integration、build-determinism、docs-parity）。DBCLI-014 與
DBCLI-015 進 `completed_stories`，`status` 推到 `done`——ForgeFlow 的 DONE 這下
merge policy 也滿足了。

順帶補掉審查留下的最後一個缺口。DBCLI-015 的 R3 要求預算「在它會跑的那台 runner
上量」，而合併前那些常數旁邊寫的是「這台機器 0.14ms，乘三倍推估 runner」——推估
不是量測。現在 CI 真的跑過了，數字直接抄回註解：100-table 預算在 ubuntu 0.08ms、
macos 0.07ms、windows 0.27ms，最慢的一台離 2ms 還有 7.4 倍；1000-table 是
0.10 / 0.07 / 0.20ms，跟 100-table 分不出來，這正是 set 查表該有的樣子。

比值那對測試也拿到了跨平台的數字：set 查表 1.03–1.15，線性掃描 8.33–9.49，門檻 3
在兩者中間，兩側都有餘裕。三個 OS 的絕對速度差了快四倍，比值卻幾乎不動——這就是
當初選比值而不選毫秒數的理由，現在有量測撐著，不只是論證。

## 導入六天後的評估（2026-09-08）

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
## DBCLI-016：handoff 不再保存工作佇列

這份檔案從此不說「現在做哪個 Story、下一個是哪個」。那兩個問題由 ForgePilot 回答，
`specs/handoff.md` 留下的是 ForgePilot 結構上拿不走的東西：為什麼這樣決定、剩下哪些
風險與假設、repository baseline，以及 `completed_stories`——由 `Story:` commit trailer
逐條對帳的交付紀錄。理由寫在 ADR-0025，gate 在 `scripts/lib/forgeflow-handoff.ts`。

促成這件事的不是潔癖，是量到的漂移。動工前在 `141cf4c3` 拿上游 `handoff-check` 跑這份
檔案，採用中的 `v0.3.2` 與當前的 `v0.6.0` 都 FAIL：`current_story: pending` 不是契約
承認的「沒有 Story」拼法（那是 `none`），`pending` 同時出現在 current 與 next 被判為
自相矛盾，`verification.detail` 是契約沒有的 key，它底下六行折疊散文則是不受支援的縮排。
`make verify` 一次都沒看見，因為上游 checker 住在 CI 沒有的 ForgeFlow checkout 裡。
**block 裡沒人讀的那半，就是已經漂掉的那半**——`next_story` 與 `status` 在整個
repository 沒有任何讀者。

所以 gate 現在直接拒絕：具名的 current／next Story 不合法，契約沒定義的 key 也不合法。
慣例會被下一個打開 ForgeFlow handoff 樣板、看到空欄位就想填的 agent 重新爭論一次；
拒絕只回答一次。三個 section 都留著，用契約自己的 sentinel——宣稱採用了 ForgeFlow，
就不能偷刪它要求的欄位。

被搬出 block 的那段話留在這裡，它本來就是散文：DBCLI-015 的實作 commit 由 ForgePilot
在確切 commit 的 detached worktree 連跑兩次 `make verify`，兩次都 PASS，那正是它的驗收
要的決定性；同樣的形狀在那個 Story 之前給過一次 FAIL 一次 PASS。Evidence ID 與 revision
刻意不抄在這裡——抄一次就要一個 commit，而那個 commit 會讓被抄的 evidence 立刻 stale。
這個限制正是 DBCLI-017 要處理的題目。

0.3.2 下還剩八條 `completed Story is not a Story ID: DBCLI-PLAT-*`，那是 0.3.2 的 Story
ID 文法早於 `DBCLI-PLAT-*` 命名，0.6.0 已經放寬。不在這個 Story 的範圍，DBCLI-018 收。

## DBCLI-017：驗證證據終於離得開這台機器

`make verify` 現在會寫出一份 Verification Attestation：一個 revision、一個指令、
一個結果，PASS 與 FAIL 都寫。檔案在 `.verification/attestation.json`，gitignored。
理由記在 ADR-0026，名詞進了 `CONTEXT.md`。

在此之前，驗證證據只存在 `.forgepilot/state.json`，而且只存在跑它的那台機器上。
那個檔案是刻意 gitignored 的：commit 進去會弄髒下一次驗證要求乾淨的工作樹，而且
「記下結果」這個動作本身要一個 commit，那個 commit 會立刻讓被記下的結果失效。
DBCLI-016 的交付報告只能寫「Evidence ID 留在 ForgePilot 的 state 裡，刻意不抄在
這裡」，就是撞到這件事。

兩個事實決定了設計，而不是 schema：

**ForgePilot 沒有 export。** 它在 `8ce2c12` 的指令是 init／migrate／goal／work／
next／start／verify／gate／review／status，development plan 裡也沒有 export 的規劃。
等它等於把交付綁在另一個 repo 的行程上；直接讀 `.forgepilot/state.json` 則是把 dbcli
綁上 ForgePilot 的內部格式，那正是 DBCLI-014 畫掉的界線。

**`make verify` 是那個固定的指令**（ForgePilot 的 `internal/work/evidence.go` 與其
測試），而且它是唯一第一手看到結果的參與者。所以由 repository 自己寫，ForgePilot／
CI／人事後讀檔案。整合介面是一個路徑加一個版本化 schema，誰都不 import 誰。

### 兩個已經被佔用的名字

`Evidence receipt`（`src/core/evidence-receipt/`）與 `Verification artifact`
（`src/core/verification/`）都是**產品**的東西：記的是 dbcli 對資料庫做的一次操作，
會出貨、有發布的 schema 版本。這份記的是一個 commit，讀的人是審查者或 CI。把它塞進
任何一個，等於為了使用者看不見的理由去動一個已發布的版本號，還會把流程工具出貨給
只想連資料庫的人。所以叫 Verification Attestation，`attestation` 在 dbcli 與
ForgePilot 都沒被用過。

### 兩個刻意的減法

沒有 `work_item`、沒有 `story`。`make verify` 不知道這兩個值，只能由呼叫端傳進來，
而**產生者查不了的欄位，記下來的就是呼叫端說了什麼**。ForgePilot 本來就用 revision
綁 Evidence，可以照同一條路綁這份檔案。這是 deferred decision，重啟條件寫在 ADR-0026。

也沒有 staleness。文件只說 revision；那個 revision 是不是還是 HEAD，每次問答案都不同，
一份自己回答這題的檔案在寫完的下一刻就是錯的。

### FAIL 也要留紀錄，代價是 recipe 裡多了一段 shell

`make` 在第一個失敗的 step 就停，所以寫在最後一行的 attestation 只會描述通過的那次
——最不需要證據的那次。24 個 step 現在包在一個 subshell 裡以 `&&` 串接，捕捉狀態、
寫檔、再以同一個狀態 exit。每個 step 都還在、順序沒動、也都還是阻斷性的；
`tests/contract/forgepilot-boundary.test.ts` 的 roster 一個字沒改，只是改成從 subshell
裡讀，並且順便擋掉 `|| true`、前置 `-` 與把 `&&` 換成 `;` 這三種偷偷放行的寫法。

實測過 FAIL 這條路：在第一個 step 前插一個 `false`，`make verify` 以非零結束，
attestation 寫出 `result: FAIL`、`exit_code: 1`、revision 正確。注意 `exit_code` 記的是
失敗那個 step 的狀態，不是 `make` 自己的錯誤碼——除錯的人要的是前者。

### review 抓到的兩個 CRITICAL

`set -o pipefail` 不是 POSIX。GNU Make 忽略環境的 `SHELL` 直接用 `/bin/sh`，而
`integration` job 跑的 ubuntu runner 上 `/bin/sh` 是 dash——實測 `ubuntu:24.04`
與 `ubuntu:22.04` 都回 `set: Illegal option -o pipefail` 並以 exit 2 中止，24 個
step 一個都不會跑，attestation 也不會寫，而且失敗看起來像驗證失敗。本機測不出來，
因為 macOS 的 `/bin/sh` 是 bash。那 24 個 step 裡沒有任何一個 pipe，所以 pipefail
本來就是個什麼都不保護的致命 no-op，直接刪掉。

roster parser 有六種寫法能一邊維持綠燈一邊把 gate 掏空：recipe 行前面加 `-`
（make 忽略錯誤，`make verify` 在有 step 失敗時 exit 0）、`exit $status` 換成
`exit 0`、在開括號那一行或閉括號之後夾帶額外指令、以及在檔案後面再定義一次
`verify:`（make 跑最後一個）。共同成因是 parser 只讀 subshell 裡面那一半，
scaffolding 整個被丟掉，而 `toContain` 是對整個檔案搜尋、註解也算數。改成把
prologue 與 epilogue 五行逐字釘死；六種寫法現在全部會 fail，逐一實測過。

### 測試自己會偽造 attestation

Security Fixture Matrix 的第一版是 spawn 真正的 writer 去測，而 writer 寫的是
canonical 路徑。結果是每跑一次 `bun test` 就在 `.verification/attestation.json`
留下一份 hash 正確、`result: PASS`、綁著當時 HEAD 的 attestation——沒有任何驗證
跑過。`parseAttestation` 會收下它：hash 證明的是內部一致，從來不是「有一次執行
發生過」。

在 CI 會真的出事：`bun run test` 是 24 個 step 裡的第 10 個，`integration` job 的
timeout 是 20 分鐘而這輪大約 15 分鐘。一旦逾時或被取消，`finish` 不會跑，而
`if: always()` 的上傳步驟會把**測試寫的那份**當成這次的結果傳上去，審查者下載到
一份「從未被驗證過的 revision 的 PASS」。

修法不是把測試指到暫存目錄，是讓那個性質不需要跑 writer 就能測：環境讀取抽成
`readEnvironment(source)`，它對 `env` 做的唯一一件事是問 `CI` 在不在。「沒有任何
環境變數的值進得了文件」因此從一句要人相信的話，變成可以餵一組敵意環境進去檢查的
東西。順帶也解掉 `new URL(...).pathname` 在 Windows 與含空白／CJK 路徑上會壞的問題
——沒有 spawn 就沒有那個路徑。

另外兩道防線：`begin` 會先刪掉任何殘留的 attestation，所以被中斷的 run 不會讓上一次
的判決被當成這一次的；contract test 掃描 `tests/` 裡任何 spawn writer 的寫法並拒絕
（pattern 是組出來的，寫死會抓到自己）。實測過：加一個會 spawn 的測試進去，這條
就變紅。

把 step 清單搬進 `scripts/` runner 的那個選項沒有被否決，只是延後：DBCLI-019 要的
per-step 時間與失敗步驟幾乎是免費的，該由那個 Story 重新評估，而不是在這裡先猜。

## DBCLI-018：升級到 0.6.0，並且讓那份契約真的被檢查

採用版本從 0.3.2 推到 0.6.0，走的是上游自己的 `./scripts/bootstrap --upgrade`，
不是手改版本號。動工前量到的三件事決定了這個 Story 的形狀：

**升級不弄壞任何東西。** 25 個 Story 在 v0.3.2 與 v0.6.0 的 `story-check` 下失敗
清單完全相同——21 條、集中在 5 個 Story，0.6.0 沒有新增任何一條。

**升級修好一件事。** `handoff-check` 從 `HANDOFF_CONTRACT_INCOMPLETE` 變成
`HANDOFF_CONTRACT_OK`：那八條 `completed Story is not a Story ID: DBCLI-PLAT-*`
是 0.3.2 的 Story ID 文法早於這個命名，0.6.0 放寬了。`docs/releases/0.6.0.md`
點名這個 repo 就是促成那次調查的對象。

**升級只有四個檔。** dry-run 列出的就是三個 `_template/` 與 marker；`AGENTS.md`
與 guidance 在首次安裝後就是 repository-owned，不在 managed 清單裡。三個 template
與 v0.3.2 原版逐字相同，沒有本地客製被蓋掉。

marker 釘的是 `v0.6.0` tag（`51ab1f20`），不是 bootstrap 當時所在的 checkout——
那個位置在 tag 之後兩個文件 commit，marker 指著未上 tag 的 revision 會讓「這是哪一版」
有兩個答案。

### 為什麼不只是改個數字

Authority、Risk、Task mode、Acceptance Evidence 在 0.6.0 全是 optional，而且**只由
上游 checker 執行**，那些 checker 住在這個 repo 沒有的 checkout 裡。只推版本號會改變
「一個 Story 被允許說什麼」，卻不會改變「什麼被檢查」——那正是 DBCLI-013 與 DBCLI-016
事後各自要收拾的形狀。

沒有選擇在 `scripts/` 裡重寫那些規則。`forgeflow-handoff.ts` 的檔頭明寫著它「刻意不與
上游 story-check 重疊」，而一份自己不擁有的契約寫兩份實作，兩邊會以沒人控制的節奏分岔，
副本會是沒人更新的那一份。所以 CI 新增一個 job，clone marker 指定的那個 revision，跑
上游自己的 `story-check` 與 `handoff-check`。

revision 是檢查的一部分：checkout 在別的 revision 會被拒絕（不同的 ForgeFlow 執行不同的
契約），沒有 checkout 也會被拒絕而不是跳過。它是 CI job 不是 `make verify` 的 step——
canonical gate 必須能從這個 repo 單獨一份 clone、離線跑完。

### 21 條舊債：列出來，不是修掉

5 個已交付的 Story 在上游 `story-check` 下有 21 條 FAIL，0.3.2 下就一模一樣，升級沒有
造成任何一條。從來沒人知道，因為 `make verify` 跑的是自家的 TypeScript 對帳，從來沒跑過
上游的 checker。

三類措辭問題：trust-boundary 欄位寫成散文、security fixture 儲存格寫成散文而非 backtick
精確值、一個 Story 的 Classification 與自己的 Superseded Behavior 互相矛盾。

| Story | 條數 | 類型 |
| --- | --- | --- |
| DBCLI-PLAT-004 | 1 | trust-boundary |
| DBCLI-PLAT-005 | 2 | trust-boundary；classification 與 superseded 矛盾 |
| DBCLI-PLAT-006 | 6 | fixture matrix 第 1–6 列 verification 欄 |
| DBCLI-PLAT-007 | 9 | fixture matrix 第 1–8 列 source field；trust-boundary |
| DBCLI-PLAT-012 | 3 | row 10 兩欄；trust-boundary |

沒有在這個 Story 裡修，是人的決定：其中 16 條是矩陣儲存格，真實的值要回到程式碼重新推導，
而且全部都是在改一份人已經接受過的驗收文本——那是改紀錄，不是排版。它是自己的一個 Story。

在那之前這 21 條被逐條列進 `PREDATING_FINDINGS`，是棘輪不是特赦：exempt 的 Story 多一條
新的會 fail，修好了卻沒刪 entry 也會 fail，沒有 entry 的 Story 必須全乾淨。清單只准縮短。

### baseline 為什麼不是 main

DBCLI-018 疊在 DBCLI-017 上，而 017 還沒合併。baseline 記的是這個 Story 實際從哪裡
長出來的那個 commit（`1ad46174`），branch 因此是 017 的分支而不是 `main`——那個
commit 不在 `main` 上，寫 `main` 會讓這兩行合起來指向一個不存在的位置。

### 沒有採用的東西

`story-check --ready` 要求每個 Story 都有 Acceptance Evidence map，現在會回報 71 條。
那是對「未來每一個 Story」的決定，不是升級的副作用，所以沒有一起打開。上游的
`templates/story/verification.md` 也沒裝——bootstrap 不管它，而 verification result
contract 在這裡還沒有消費者。

## DBCLI-019：同一個 commit 不該給出兩種判決

`forgepilot verify` 在同一個 commit `c3230d79` 上給出過 FAIL、FAIL、PASS
（EV-018 到 EV-020），程式碼一行沒變。加壓重現（`bun run test:perf`，十核機器上掛
八個 CPU 忙迴圈）改前十跑十敗，閒置時穩過。

哪一條斷言造成 EV-018／EV-019 **無法回推**——ForgePilot 的 FAIL evidence 只留 exit
status，浮上來的輸出止於 bun 的 `error: script "test:perf" exited with code 1`。所以
「重現並指名」被寫成 Story 的第一項工作，而不是前提；startup 只是有文件佐證的嫌疑犯。
重現結果推翻了那個猜測：三條斷言都會翻，而不是一條。

GATE-003 選比例斷言，落地在兩條上（flattened docs 用「一列巢狀 vs 全平坦」，
redactFields 用深度比值）。startup 做不出來，量測寫在 Story 的 `task.md`：裸直譯器
啟動閒置與加壓都是 6.5–7.6ms 完全不動，而 `--help` 是 172→285ms，所以 `help/bare`
從 20–25 漂到 31–44，比絕對值更糟。GATE-004 因此改量位元組——`dist/cli.mjs` 只答
`--version`，其餘一律動態載入 `./cli-runtime`，兩個檔的大小是 build 的性質。

`test:perf` 也加了 `--timeout 30000`：bun 預設的 5000ms per-test timeout 同樣是一條
會被負載翻掉的絕對門，而且翻掉時連數字都不印。

剩下十九條沒有修好，只是被揭露：`tests/unit/build/perf-absolute-time-budgets.test.ts`
逐檔登記，數量只能往下走。這是刻意的——常數因子的退步只有絕對時間量得到。

## DBCLI-020：那十九條，換的是量不是比較方式

`ABSOLUTE_TIME_BUDGETS` 從 19 歸零。加壓十輪改前 1/10 敗、改後 0/10——同一份程式碼
另外兩次取樣是 3/10 與 6/10，失敗率本來就是機器忙碌程度的函數。

GATE-005 選計數器。`MaskingCost` 掛在 `FilterColumnsResult.cost` 上凍結回傳，不是
全域計數器：全域是共享狀態，兩個呼叫會交錯、測試會忘記清。六個欄位各對著一個具體
退步，`nestedProbeRows`、`pathSplits`、`nestedGlobMatches` 分別是「一列巢狀拖垮
999 列」「每列重新切路徑」「收鍵而不是收規則」。

**第一版的計數器自己違反了 ADR-0028。** 「沒有東西被移除」那個提前返回回報零成本，
但落空的規則才是走遍每一列的那些——benchmark 會認證一段它沒看過的走訪。在任何斷言
寫上去之前修掉，兩個方向釘在 `tests/unit/core/blacklist-masking-cost.test.ts`。

沒有可數的量的那幾條各自處理：查找與 config 載入改成「查找真的發生且答案沒變」加
一條載入的規模比值（線性，量到 10.34，門檻 25——不能用 `MAX_SIZE_SCALING` 的 3）。

**放棄掉的保護要記住：端到端查詢延遲不再有自動的門。** 一次 CLI 往返大半是 process
啟動與 I/O 等待，沒有 in-process 的量能把負載除掉，加壓下曾經量到 spawn 被砍、
`status` 回 `null`。`query.bench.ts` 現在斷言往返成功且有輸出，延遲只印。要擋延遲
退步得在受控 runner 上做，不是 `make verify` 的事。

計數器量的是做了多少事，不是多快：同樣走訪但更慢的實作不會被抓到，所以每個 case
仍然把時間印出來給人看。ADR-0028 的失效條件就寫在這裡。

### 兩個 Story 的 trailer 是補的

`efabbd3e`（DBCLI-019 的實作）與 `d9a5a716`（DBCLI-020 的實作）都沒有帶
`Story:` trailer，交付當下漏掉了，兩個 PR 也已經合併進 `main`。發現它的是
`bun run forgeflow:check`——這正是那道門存在的理由。

補救方式是這個 handoff commit 帶上兩個 trailer，而不是往
`DELIVERED_BEFORE_TRAILERS` 加兩筆：那份名單自己寫著「只能縮不能長」，用它來吸收
一次當下的疏漏，就是把 ratchet 變成 amnesty。所以紀錄留在這裡：trailer 是補的，
真正做事的是上面那兩個 commit。

## DBCLI-021：決策記錄從散文連結變成被檢查的連結

DBCLI-018 導入的四個 Story section 裡，`## Architecture` 在這裡一直是不可用的：
`Decision:` 只解析到 `specs/decisions/`，而這個 repo 的決策在 `docs/adr/`。
DBCLI-020 需要它——那張改動了 `BlacklistValidator` 對外的樣子——只能把連結寫成散文。

回報成 ForgeFlowV2 issue #23，上游在 v0.7.0（`cb4bc976`）加了
`FORGEFLOW_DECISIONS_ROOT`，未設定時維持原本的預設。剩下的一半是這邊的。

動工前量到：25 個 Story 在 v0.6.0 與 v0.7.0 下都是同樣的 21 條 finding；
`FORGEFLOW_DECISIONS_ROOT=docs/adr` 單獨設定仍然失敗，因為查找的是
`<root>/ADR-<digits>.md`；把記錄寫成 `0028` 則會撞上 id 文法。上游的 release note
明說檔名文法不在修改範圍內，所以那是邊界，不是疏漏。

於是 28 份記錄改名成 `ADR-<digits>-<slug>.md`（`git mv`，歷史跟著走），留在
`docs/adr/`——搬去 `specs/decisions/` 會讓決策與引用它的文件分家，那正是當初排除
那條路的理由。ADR-0029 記下這個決定，而 DBCLI-021 自己宣告 `## Architecture`
指向它，是這個 repo 第一個宣告得起來的。

### 兩件計畫外的

**檔名不是全部。** 上游還把狀態讀成內文的 `* Status:` bullet，而這裡 29 份用 YAML
frontmatter。兩種並存等於一份記錄兩個狀態，所以整批轉成 bullet；四份帶額外欄位的
（`accepted`／`dogfooded`／`amends`／`superseded_by`／`reopen_trigger`）一併處理，
`amends: 0012` 這類指涉改成 `ADR-0012`。

**改名差點留下四條死連結。** 記錄之間互相引用寫的是相對路徑 `](0012-....md)`，
沒有 `docs/adr/` 前綴，掃 34 處前綴引用的那一輪看不到。是讀那兩份 superseded 記錄
時發現的，不是被檢查抓到的——`tests/unit/build/adr-references.test.ts` 現在涵蓋兩種
連結形狀與 Status 宣告。

### 為什麼變數設在腳本裡

`FORGEFLOW_DECISIONS_ROOT` 寫在 `scripts/check-forgeflow-contract.ts` 而不是留給
呼叫者。一個要人記得設的變數，會讓檢查在本機過而在 CI 紅，或者反過來——那種失敗
說的是環境，不是這個 repo 的內容。

## DBCLI-022：第一條被拿掉的例外

DBCLI-018 讓 CI 跑上游 ForgeFlow 自己的檢查（ADR-0027），當時有五個已交付的
Story 落在二十一條 findings 上。那份清單寫著「只能縮短，不能增長」，但在這一輪
之前沒有縮短過。DBCLI-022 拿掉第一條，也是最小的一條：DBCLI-PLAT-004 只有一條
`every trust-boundary field must name an exact field, not prose`。

**這條 finding 指的不是排版。** 上游的規則是每個 bullet 要含一段非空的反引號
（`forgeflow_count_literal_bullets`、`forgeflow_has_literal`），PLAT-004 十個
bullet 裡只有一個不合：`Serialized stdout bytes — final 65,536-byte limit and
single-document framing`。替那句話加上反引號就會過，而那正是不該做的事——它根本
不是欄位，而位元組上限與單一文件框架早就是 R12／R13／R14 並且在 acceptance 被斷言。

拿著程式碼重推那一節，發現兩處宣告不只是不精確：

* **`warnings[].message` 不是 curated 文字。** 原本寫「derived diagnostic
  vocabulary and curated English text」，但重複需求的警告是
  `Duplicate capability id '${id}' in --require was ignored.`
  （`src/core/capabilities/check.ts:70`），內插的是使用者打進來的 id。它安全的
  理由跟宣告寫的不是同一個：那個 id 在 `validAgentRequirements`
  （`src/commands/capabilities.ts:129-138`）已經先過了 `CAPABILITY_ID_PATTERN`
  與 160 字元上限。整合測試裡的 `SELECT * FROM users` 與 `/tmp/secret` 兩列，斷言
  的就是這個。
* **`evidence[]` 與 `recovery` 這個 Story 從來不產生。** `toAgentEnvelope` 與
  `createAgentOutputFailure` 無條件寫 `evidence: []`、`recovery: null`。它們跨界
  只發生在 `parseOperationEnvelope(unknown)` 裡——那是從 `@carllee1983/dbcli/core`
  匯出、讀一份它管不到的文件的入口。把它們跟 `argv` 並排列，讀起來像是 dbcli
  會產生這些值。

所以那一節現在按**邊界**分成兩段，而不是攤平成一張表。同一個欄位名在兩個邊界上
被約束的理由不同，分不出來的讀者就分不出哪些欄位是 dbcli 自己該負責收斂的。

**沒有動 acceptance。** 重寫後宣告的每個欄位，都已經有一條被接受的 acceptance
criterion 與一支被引用的測試；為了讓宣告與驗收看起來對稱而改寫人類已核可的驗收
文字，是動紀錄，不是補檢查。

**沒有動 `src/`。** 這一輪是治理修正，不發布版本。

剩下四個 Story、二十條 findings。其中 PLAT-006 與 PLAT-007 合起來是十六格
security fixture cells，要從程式碼重推，各自是自己的一輪。

## DBCLI-023：第二條例外，以及最後一個 Classification 矛盾

PLAT-005 是五條裡唯一同時帶兩種 finding 的：一條跟 PLAT-004 同形的
trust-boundary 散文（`Serialized stdout bytes — must never exceed 65,536 UTF-8
bytes`），另一條是 `Baseline conformance: no` 卻帶著 `## Superseded Behavior`
——上游 R8 說宣告 `no` 的 Story 不得帶那一節。

**第二條有兩個出口，而它們不等價。** 翻宣告，或刪那一節；兩者都能讓 checker 閉嘴，
但一個保住紀錄、一個毀掉紀錄。

判斷的依據不是語感，是同一個 repo 裡的四個兄弟。PLAT-005 那一節寫的是真的：
PLAT-004 曾把 `operation` 限定在 `capabilities.check`、曾把
`dbcli --agent-output capabilities` 當成 unsupported operation 拒絕，兩件事
PLAT-005 都刻意換掉了——正是 template 講的「each existing test or documented
behavior this Story intentionally replaces」。而 DBCLI-017（`make verify` 步驟
名冊）、DBCLI-020（十九條絕對時間斷言）、DBCLI-PLAT-011（交付後就會變錯的文件
句子）、DBCLI-PLAT-012 這四個 Story，全是「改動並取代既有具名行為」這個形狀，
全都宣告 `yes`。照 `no` 讀，PLAT-005 會是這個形狀裡唯一相反的一個。

所以錯的是宣告，改一個字，兩半都留住。刪掉那一節同樣會過，代價是 PLAT-005
到底取代了什麼再也沒有任何地方寫著。

trust-boundary 那半重推之後發現剩下的宣告是**單薄**而不是錯的。
`capabilities.list` 的答案來自 `buildCapabilityCatalog()`，回傳
`Object.freeze` 過的 `CAPABILITIES`；`src/core/capabilities/` 的整個 import graph
被斷言不含 `process.env`、`Bun.file(`、`node:fs`、`import(`
（`tests/contract/capability-contract.test.ts`）。舊宣告把這寫成 catalog「must
contain no dynamic environment variables, paths, or database credentials」，像是
一條待辦要求；它其實是程式碼**已經有**而且被結構性檢查釘住的性質。

剩下三個 Story、十八條：十六格 security fixture cells，加上 PLAT-007 與
PLAT-012 各自的 trust-boundary 一條。Classification 矛盾這一類已經清空。

沒有動 acceptance，沒有動 `src/`。

## DBCLI-024／025／026：清單歸零，以及散文藏著的兩件事

剩下的十八條一次收完，`PREDATING_FINDINGS` 現在是空的，兩個計數都是 0。五輪
下來每一條都是拿程式碼重推宣告，沒有一條是替上游挑剔的那句話加反引號。

**最值得留下的一句：把二十一條逐條列出來而不是記一個數字，是對的。** 因為
checker 的輸出裡，「這格措辭鬆」跟「這列什麼都沒測」是同一行字。

### PLAT-006：三列 fixture 什麼都沒斷言

六條 finding 全是 `states verification as prose`。換成檔案路徑是兩分鐘的事，而
且對其中一半是錯的：

| 列 | payload | 宣稱 | 原本實際有的 |
| --- | --- | --- | --- |
| 1 | `DBCLI-PLAT-006` | preserve，兩個 sink | 只有 audit |
| 2 | `INC-2026.09.05` | preserve，兩個 sink | 只有 envelope |
| 3 | `../../PLAT006_PATH` | reject | 有 |
| 4 | `postgresql://plat006:…` | reject | 沒有 |
| 5 | `SELECT * FROM users…` | reject | 沒有 |
| 6 | `PLAT006_RAW_ERROR_SENTINEL` | preserve，兩個 sink | 全 repo 找不到這個字串 |

第 4、5 列最危險，因為它們**看起來有**：payload 確實出現在
`tests/unit/core/operation-envelope.test.ts`，但那測的是
`OperationEnvelope.context.correlationId`——矩陣裡另有一列專測它的**另一個 source
field**。拿它當引用會是一個能解析、讀起來合理、卻對該列什麼都沒證明的引用。那比
散文更糟，散文至少沒指名檔案。

補的是斷言不是行為：`CORRELATION_ID_PATTERN` 是
`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/`，三個 reject payload 各含一個不在字元集裡
的字元，三個 preserve payload 都符合。新測試對未修改的 `src/` 一次就過，這正是
「找到的是覆蓋缺口不是缺陷」的證據。

### PLAT-007：第八列的機制不存在

七列都推得出具名欄位。第八列 `command stdout/stderr` 推不出來——因為沒有任何被
捕獲的行程輸出會進 evidence receipt。fixture 裡 `PLAT007_UNBOUNDED_OUTPUT` 是跟
`PLAT007_ROW_SENTINEL` 同一個 diagnostic 結果的另一個欄位，兩者都走
`ReportFinding.rows`。列是真的、payload 是真的，標籤描述的機制是假的。現在它跟第
一列共用 source field、以 payload 區分——誠實的重複，好過發明一個區別。

### PLAT-012：宣告講的是風險，程式碼給的是保證

row 10 的 persisted locations 原本寫 `stderr, audit entry`，那是**替代字串**的去處，
不是 payload 的去處，而那一欄問的是後者。`cacheWriteReason` 從不引用被捕獲錯誤的
`.message`：`SchemaCacheWriteError` 給自己那句（依建構就不含路徑），`ConfigError`
給固定句，其餘一律換成 `The local schema cache could not be written.`。原始訊息是
被丟棄不是被遮蔽，redaction 工具根本沒機會看到它。所以是 `none`，跟 PLAT-004 自己
的 `redact` 列同一個慣例。

順帶查清楚但沒改：分類後的字串確實會進 audit entry，位置是**頂層 `error` 欄位**
而不是 `metadata` 底下，而且只在 audit 啟用時；被引用的 fixture 剛好把 audit 關掉。
這些都不屬於那一格，記在這裡。

### 空清單不是「不再檢查」

`PREDATING_FINDINGS` 與兩個計數留著。空的意思是棘輪到底了：任何一條 finding 現在
都會讓 gate 紅，而要加回一條就得**調低**——不能調高——那兩個數字。

### 那個落差修掉了，理由跟原本的判斷相反

上一節原本記著：DBCLI-022／023 宣告 `push: no` 而分支被 push 了，不回頭改，因為
Authority 記的是核可當下授予了什麼，而改寫已核可 Story 正是 DBCLI-021 拒絕的事。

**量一下就翻案了。** 這個 repo 裡所有曾經宣告 `## Authority` 的 Story 共八個，
**八個全部**寫 `push: no`，而八個全部都經由合併的 PR 進了 main；其中三個還寫
`commit: no`，而它們帶著自己 `Story:` trailer 的 commit 就在 main 上。

八分之八不是決定的紀錄，是模板預設值被抄了八次沒填。改它不會毀掉任何決定，因為
從來沒有人做過那個陳述。原本的推理對「已核可的紀錄不要動」是對的，錯在把這件事
歸成那一類。

真正有用的是另一半：**它能活過八個 Story，是因為沒有東西拿它跟任何東西比對。**
上游的 checker 只驗值是不是 `yes`／`no`，沒有任何地方問過它是不是真的。一個沒有
東西去比對的宣告不是控制，措辭再嚴謹都不是。

比對的材料看起來本來就在：`completed_stories` 是這個 repo 自己說某個 Story 進了
main，而它只可能是以 commit、經由被 push 的分支進去的。`reconcileDeliveryAuthority`
當時就檢查這一條。**那一步是錯的，下一節說明並且已經移除。**

順帶對帳出第二件過期：DBCLI-022 到 026 已交付、已合併、已通過 Human Review，卻都
沒被登進 `completed_stories`。一併補上——這一半站得住，跟 Authority 無關。

### 交付說的是「進了 main」，不是「誰做的」

上一節那條規則活了一天。它擋掉的第一個東西不是漏填的模板，是這個 repo 的正常流程：
**agent 拿到 `modify`、最多一個本機 `commit`，接手 commit、push、開 PR、合併的是人。**
交付是完整的，agent 的 `push: no` 從頭到尾都是真的，而 gate 指名拒絕它。

ADR-0030 自己寫的失效條件是「交付不再蘊含被 push 的分支」。交付到今天仍然蘊含一條
被 push 的分支——它從來沒有蘊含**是 agent** push 的。那一步才是規則真正在做的推論。

第二個症狀指向同一件事：同一個宣告被判兩次不同的結果。上游 0.7.0 的 Execution
Contract（`protocol/execution.md`，`specs/.forgeflow-adoption` 釘住的 revision）把
`plan`、`modify` 以外每一項的預設值定為 `no`，並且明說「做得到某件事從來不是被授權
去做它」。所以省略 `push:` 跟寫 `push: no` 是同一句話；那條規則卻擋顯式的 `no`、
放行省略的那個——刪掉一行就是穿過去的辦法。

移除的只有那條推論。Story 目錄存在性、`Story:` trailer、`DELIVERED_BEFORE_TRAILERS`
棘輪、淺複製拒絕、lifecycle 結構檢查全部原封不動，每一條都留著一支會在它消失時變紅
的測試。DBCLI-027 對的那半句——沒有東西比對過的宣告不是控制——本來就不是在講
Authority，那是上面那幾條規則已經在做的事。Authority 的格式、預設值與組合合法性由
`bun run forgeflow:contract` 對著採用的 revision 檢查；它是不是真的，是 Human Review
的問題。這個 repo 觀察不到指令是誰下的，會猜的 gate 比沒被檢查的宣告更糟，因為它的
判決長得像證據。

**那八個被改寫的宣告留在原處。** ADR-0030 把 DBCLI-019 到 026 的 `push: no` 改成
`yes`，其中 019、020、021 的 `commit: no` 也一併改了。查不到任何逐項記錄那八個 Story
授予了實作 agent 什麼的核可紀錄。改回 `no` 會是同一個錯誤的鏡像——從沒有證據推論
權限被收回——所以不改。能更正一個歷史宣告的只有核可紀錄，merge 或 push 都不是。
決定與失效條件在 ADR-0031。

一個順帶的指標修復：上游 `protocol/architecture.md` 明說 `superseded` 的記錄不能當
依賴，所以 DBCLI-027 的 `Decision:` 改指 ADR-0031，並在該 Story 裡寫明它當初做的
決定是 ADR-0030。這是指標修復，不是改寫那個 Story 主張過的東西。

DBCLI-027 與 DBCLI-028 都在合併後補進 `completed_stories`。DBCLI-027 是它自己那一輪
就漏掉的——它花力氣補上 DBCLI-022 到 026 的同一份清單，沒有把自己放進去；DBCLI-028
則是在 PR #187 合併的當下補的。兩筆都由自己的 `Story:` trailer 背書。這份清單只有在
交付之後才登記，而登記這一步沒有任何 gate 會提醒，所以它是這裡最容易再過期一次的
地方——DBCLI-027 的紀錄裡已經有一次「已交付已合併卻沒登進去」的前例。

## Lifecycle

`current_story` 與 `next_story` 永久是契約的 sentinel。要知道現在該做什麼，問
`forgepilot next`，不要問這個區塊。

```yaml
workflow:
  current_story: none
  next_story: pending
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
    - DBCLI-PLAT-004
    - DBCLI-PLAT-005
    - DBCLI-PLAT-006
    - DBCLI-PLAT-011
    - DBCLI-PLAT-012
    - DBCLI-PLAT-013
    - DBCLI-PLAT-007
    - DBCLI-014
    - DBCLI-015
    - DBCLI-016
    - DBCLI-017
    - DBCLI-018
    - DBCLI-019
    - DBCLI-020
    - DBCLI-021
    - DBCLI-022
    - DBCLI-023
    - DBCLI-024
    - DBCLI-025
    - DBCLI-026
    - DBCLI-027
    - DBCLI-028
    - DBCLI-029
    - DBCLI-030
    - DBCLI-031
    - DBCLI-032
  status: done

baseline:
  repository: CarlLee1983/dbcli
  branch: main
  commit: 1b22b47c3c6cc982091db8471549ca4736abad2c
  dirty_worktree: false
  story_owned_paths:
    - specs/stories/DBCLI-028-delivery-is-not-authorization/story.md
    - specs/stories/DBCLI-028-delivery-is-not-authorization/acceptance.md
    - docs/adr/ADR-0031-delivery-does-not-record-who-performed-it.md
    - scripts/lib/forgeflow-handoff.ts
    - scripts/check-forgeflow-handoff.ts
    - tests/unit/scripts/forgeflow-handoff.test.ts
    - README.md
    - specs/stories/DBCLI-027-authority-that-matches-delivery/story.md
    - specs/stories/DBCLI-027-authority-that-matches-delivery/acceptance.md
    - docs/adr/ADR-0030-a-permission-nobody-filled-in-is-not-a-control.md
    - scripts/lib/forgeflow-handoff.ts
    - scripts/check-forgeflow-handoff.ts
    - tests/unit/scripts/forgeflow-handoff.test.ts
    - specs/stories/DBCLI-024-plat-012-cache-write-failure-field/story.md
    - specs/stories/DBCLI-024-plat-012-cache-write-failure-field/acceptance.md
    - specs/stories/DBCLI-025-plat-006-verification-that-exists/story.md
    - specs/stories/DBCLI-025-plat-006-verification-that-exists/acceptance.md
    - specs/stories/DBCLI-026-plat-007-receipt-source-fields/story.md
    - specs/stories/DBCLI-026-plat-007-receipt-source-fields/acceptance.md
    - specs/stories/DBCLI-PLAT-006-correlation-id/acceptance.md
    - specs/stories/DBCLI-PLAT-007-bounded-evidence-receipts/story.md
    - specs/stories/DBCLI-PLAT-007-bounded-evidence-receipts/acceptance.md
    - specs/stories/DBCLI-PLAT-012-schema-cache-write-boundary/story.md
    - specs/stories/DBCLI-PLAT-012-schema-cache-write-boundary/acceptance.md
    - tests/integration/lazy-entry-path.test.ts
    - tests/integration/capabilities-command.test.ts
    - tests/unit/core/audit/integration-helper.test.ts
    - docs/adr/ADR-0026-a-verification-attestation-is-not-an-evidence-receipt.md
    - docs/adr/ADR-0027-upstream-forgeflow-checkers-are-run-not-reimplemented.md
    - docs/adr/ADR-0028-masking-cost-is-observable-without-a-clock.md
    - docs/adr/ADR-0029-decision-records-are-named-so-the-contract-can-resolve-them.md
    - specs/stories/DBCLI-023-faithful-plat-005-classification/story.md
    - specs/stories/DBCLI-023-faithful-plat-005-classification/acceptance.md
    - specs/stories/DBCLI-PLAT-005-agent-json-mode/story.md
    - specs/stories/DBCLI-022-faithful-plat-004-trust-boundary/story.md
    - specs/stories/DBCLI-022-faithful-plat-004-trust-boundary/acceptance.md
    - specs/stories/DBCLI-PLAT-004-operation-envelope-v1/story.md
    - scripts/lib/forgeflow-contract.ts
    - tests/unit/scripts/forgeflow-contract.test.ts
    - specs/handoff.md
    - specs/.forgeflow-adoption
    - specs/stories/README.md
    - specs/stories/_template/story.md
    - specs/stories/DBCLI-021-resolvable-decision-records/story.md
    - specs/stories/DBCLI-021-resolvable-decision-records/acceptance.md
    - specs/stories/DBCLI-021-resolvable-decision-records/task.md
    - docs/adr/ADR-0029-decision-records-are-named-so-the-contract-can-resolve-them.md
    - scripts/check-forgeflow-contract.ts
    - tests/unit/build/adr-references.test.ts
    - AGENTS.md
    - specs/stories/DBCLI-019-load-independent-perf-verdict/story.md
    - specs/stories/DBCLI-019-load-independent-perf-verdict/acceptance.md
    - specs/stories/DBCLI-019-load-independent-perf-verdict/task.md
    - specs/stories/DBCLI-020-perf-gates-without-a-clock/story.md
    - specs/stories/DBCLI-020-perf-gates-without-a-clock/acceptance.md
    - specs/stories/DBCLI-020-perf-gates-without-a-clock/task.md
    - docs/adr/ADR-0028-masking-cost-is-observable-without-a-clock.md
    - src/core/blacklist-validator.ts
    - tests/perf/startup.bench.ts
    - tests/perf/query.bench.ts
    - tests/perf/blacklist-performance.bench.ts
    - tests/perf/contiguous-section-matcher.bench.ts
    - tests/unit/build/perf-absolute-time-budgets.test.ts
    - tests/unit/core/blacklist-masking-cost.test.ts
    - package.json
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: pass
```

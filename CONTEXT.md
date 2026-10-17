# Documentation Governance Context

This context defines the project's language for planning, recording, and proving
software changes. It keeps current behavior, product contracts, historical
decisions, and completion state from being conflated.

## Language

**Source of truth**:
The scoped authority for a particular question. Behavior, product contracts,
decision rationale, and completion state may each have different authorities.

**Implementation plan**:
A bounded document that turns a decided design into work, acceptance, and
verification. It is not a permanent behavior contract.

**Design record**:
A historical record of intent, trade-offs, and deviations. It is not a task
list.

**Completion evidence**:
Bounded proof that an outcome meets its acceptance criteria, including the
relevant changes, tests, documentation checks, and known risks.

**Deferred decision**:
An intentionally postponed choice with an explicit condition for reopening it;
it is not an unspecified future TODO.

**Known deviation**:
A named part of delivered work that intentionally does not satisfy its own
acceptance criterion, recorded with what it deviates from and what would make
it worth revisiting. It is neither a TODO nor an unreported defect: work
carrying one is delivered, not complete.

**Unverified**:
An acceptance criterion whose implementation exists but which no test asserts.
It is a statement about proof, not about correctness, and it is distinct from a
known deviation: nobody has decided the criterion is unmet, nobody has shown it
is met. A partially asserted criterion is unverified, not covered.

## Semantic query-drafting language

**QueryDraft**:
An explicit, unexecuted candidate saved-query reference or read-only SQL
artifact. It is untrusted input until the offline draft validator accepts it;
acceptance never grants execution permission.

**Draft validator**:
The deterministic, local boundary that checks a `QueryDraft` against the
governed semantic context and existing SQL safety rules. It neither calls a
model nor executes SQL.

**Agent-driven drafting**:
An external agent creates a `QueryDraft` and submits it to dbcli for local
validation. The agent's provider choice, credentials, and model context remain
outside dbcli.

**Provider-driven drafting**:
dbcli explicitly calls an approved provider to create a `QueryDraft`. It is a
separate, policy-gated transport concern and uses the same validator; it is not
a different permission tier.

## Agent data-work language

**Evidence receipt**:
A bounded, machine-readable record of one explicit dbcli operation. It proves
what dbcli observed or verified under a particular governed context; it never
contains database rows, unredacted SQL, credentials, or an agent's conclusion.

**Verification attestation**:
A bounded, machine-readable record of one `make verify` run against one
repository revision, written by that run and never committed. Its subject is a
commit, not a database, and its reader is a reviewer, a CI job, or ForgePilot —
so it is not an evidence receipt and not a verification artifact, and it lives
in `scripts/` rather than being shipped. It states a revision; whether that
revision is still HEAD is the reader's question, never the document's.
_Avoid_: verification receipt, evidence receipt, build attestation

**Evidence pack**:
A reviewable collection that connects one or more human- or agent-authored
claims to evidence receipts, verification artifacts, and audit references. A
pack makes provenance inspectable; it does not make a claim true.

**Claim**:
Bounded human- or agent-authored text in an evidence pack. It is untrusted
interpretation, not a dbcli verification verdict or executable assertion.

**Semantic contract**:
An approved, version-controlled business definition whose references are
validated against the governed semantic context. It is not a database-schema
contract, a permission rule, or executable SQL.

**Data subject**:
A stable, connection-scoped identity for a governed physical or semantic
object. It is not an unqualified table name that can collide across connections.

**Impact assessment**:
A deterministic report of known effects of a proposed schema/design change on
governed semantic references, saved queries, verification evidence, observed
workload, and explicitly declared code access. It reports the limits of its
coverage rather than claiming to find every application dependency.

**Coverage gap**:
An explicit statement that an impact assessment lacks a source needed to rule
out an effect. It is a warning, never a clean result.

## Outcome vocabularies

Three vocabularies describe how something turned out. They are not
interchangeable, and none of them may be mapped onto another.

**Verification status**:
The verdict a verification artifact records about its subject — `verified`,
`not_verified`, `indeterminate`, or `blocked`. Alone among the three it is a
judgment about the database, and it is part of a published JSON contract.

**Report finding**:
How one diagnostic snippet in a report snapshot turned out — `ok`, `no-data`,
`skipped`, `error`, or `timeout`. It says whether a diagnostic ran, not whether
anything was verified.

**Workload source**:
Whether an explicit proxy event file offered to an impact assessment could be
used — `available`, `absent`, `invalid`, or `unavailable`. It describes the
source, not a finding about the database, and it is always advisory.

## Agent integration language

**Operation envelope**:
A versioned, bounded, machine-readable response for one explicitly requested,
finite dbcli invocation. One invocation produces exactly one complete JSON
document. It is not persisted or itself evidence; its `evidence` field contains
only bounded references to existing evidence receipts. Its `status` describes
only whether the invocation succeeded or failed; command-specific findings and
outcomes remain in `data`.
_Avoid_: Evidence envelope, agent receipt

**Capability**:
One atomic dbcli ability with a stable dotted id — `schema.read`,
`data.delete`. It names what the *tool* can do. A job or a method
(`dba.tune-production`, `crud.scaffold`) is not a capability; it belongs to the
Role Skill or Method Skill that composes dbcli. Capabilities split by their
effect on configuration, not by command: reading the blacklist and changing it
are two capabilities even though both live under `blacklist`.

**Capability catalog**:
The complete, versioned, statically known set of capabilities. It is derived
from the engine capability matrix rather than declared beside it, so it cannot
claim engine support the matrix does not grant. Reading it requires no database
connection.

**Capability contract version**:
`CAPABILITY_CONTRACT_SCHEMA_VERSION`. It moves when the catalog's shape
changes and never because the npm package version moved, following the same
rule as the evidence artifact versions.

**Discovery**:
Answering "what can this tool do". It is not a permission grant: a capability
appearing in the catalog says the binary is able to do it, not that anyone may.

**Capability availability**:
Whether the *locally configured* engine, agent mode and permission would refuse
a capability — `available`, `unavailable`, or `unknown`. It is a statement about
this machine's configuration, evaluated without connecting to a database. It is
distinct from approval: blacklist, write gate, confirmation and audit all still
run at execution time, and human consent is not modelled at all. `admin` in a
config file is a permission level, not a DBA sign-off.

**Context unavailable**:
There is no local configuration here, so availability could not be established.
It is neither `available` nor `unknown`: the requirement was understood, the
environment was not. The default configuration is never reported as though it
were configured.

**Context unresolvable**:
A configuration exists and could not be turned into an engine and a permission
— an `{"$env": "..."}` reference naming an unset variable, for instance. It is
a different fact from *context unavailable*, and reporting it as one would
state something false about the machine. Both fail closed.

**Schema cache**:
The table shapes dbcli has read, stored locally so later commands need not read
them again. It lives inside `config.json` and in the layered store under
`.dbcli/schemas/`, but storage is the only thing it shares with the
configuration: it is *derived* data, re-readable at any time from the database
the configuration already points at, and it holds nothing an agent that can run
`dbcli schema` cannot already see. Writing it is therefore not a configuration
change, and it is not behind the agent-mode boundary. Connection identity,
permission and credentials are configuration; the cache next to them is not.

**Environment gate**:
A refusal decided before execution and knowable without connecting — agent
mode is the only one today. It is distinct from an execution-time gate
(blacklist, write gate, confirmation, audit), which capability availability
deliberately does not speak for. The dividing line is *when* the refusal is
decided: what is decidable here is the contract's responsibility to report.

## Skill layering

**Tool** (`dbcli`):
What can be done at all.

**Tool Skill** (the dbcli Skill):
How to operate dbcli safely.

**Method Skill**:
How a method of working proceeds — CQRS, event sourcing, migration practice.

**Role Skill**:
How a job proceeds — DBA operations, CRUD engineering, review.

**Project governance** (`AGENTS.md`):
Which Skills apply here, how they are routed, and where the permission
boundaries lie.

Role, Method and project knowledge never enter dbcli core. dbcli answers only
for the first two layers.

**Engine layer**:
What a Role Skill learns about a database by asking the database itself in SQL
— replication lag, replication slots, WAL or binlog position, roles and grants,
connection TLS. It is the same wherever the database runs, and it is read
through dbcli.

**Platform layer**:
What only the platform hosting a database knows — the backup catalog, the
point-in-time recovery window, automatic failover settings, storage growth.
It differs per platform (a managed cloud service, or self-hosted tooling) and
is read outside dbcli. A platform a Role Skill does not cover reports its
platform-layer state as indeterminate.
_Avoid_: infrastructure layer, cloud layer

## DBA 工作流程用語

本節描述 Role Skill 的工作結論，與上述 dbcli outcome vocabularies 分屬不同層次。
決策與判定規則見 [ADR-0046](docs/adr/ADR-0046-dba-conclusions-reference-tool-evidence.md)。

**工具執行結果（Tool outcome）**：
一次工具操作是否成功執行的結果，不代表 DBA 主張成立。
_Avoid_: DBA 驗證通過

**DBA 主張（DBA claim）**：
在指定對象、環境、時間與適用條件下，需要證據判定的敘述；例如備份存在或某次演練符合復原目標。
它不是 dbcli evidence pack 的 Claim，也不是工具已給出的驗證判決。

**主張結果（Claim conclusion）**：
對單一 DBA 主張的判定：符合（`met`）、不符合（`not-met`）、受阻（`blocked`）或無法判定（`indeterminate`）。
它不等同於命令成功、dbcli verification status 或整個流程的完成狀態。

**工作流程結果（Workflow result）**：
一次有明確範圍的 DBA 評估紀錄，連結各主張的結論、理由、證據與缺口。
其摘要保留混合結果，不能由部分主張成立推導全部符合。
_Avoid_: Operation envelope, evidence receipt

**本次未評估（Not assessed）**：
某主張不在本次評估範圍內的標示，不是通過，也不是主張結果的第五種狀態。

**必要證據（Required evidence）**：
主張的判定規則事先要求具備且符合適用條件的證據；欠缺時不能證成符合或不符合。

**歷史結論（Historical conclusion）**：
某次評估在當時範圍與條件下留下的判定，不保證現在仍適用。
證據後續失效或新的評估不會覆寫它。

批准與交接的決策見 [ADR-0047](docs/adr/ADR-0047-dba-human-approval-is-scoped-to-an-execution-plan.md)。

**工作流程批准（Workflow approval）**：
有權者對具體計畫版本、環境、資源與操作的同意，限定本次執行、時間窗及允許的重試範圍。
它不等於工具確認、操作成功或 DBA 主張成立。
_Avoid_: Write gate 放行、執行完成

**批准點（Approval point）**：
runbook 事先指定、必須取得有效工作流程批准才能繼續的關卡。
agent 可以因未涵蓋的風險追加暫停，不能自行取消既定批准點。

**批准紀錄（Approval record）**：
連結確定的批准內容、批准者、決定、時間、條件與來源的紀錄。
拒絕、撤回與後續決定追加保存，不覆寫原決定；紀錄中的姓名本身不證明批准資格。

**執行交接（Execution handoff）**：
將待執行步驟交由指定執行者承接，要求確認批准有效、計畫與目標一致及前置條件成立。
批准後仍可能等待執行，操作與驗證證據須在執行後另行交回。

## Connection configuration language

**Connection string**:
A single line that describes one connection, as copied from a database service
or client, such as `mongodb+srv://…`.
_Avoid_: URI, full URI, DSN

**Field config**:
The form that describes a connection as separate values — host, port, user,
password, database and the like.
_Avoid_: component format, per-field setup

**Decompose**:
To turn a connection string into an equivalent field config.
_Avoid_: parse, convert

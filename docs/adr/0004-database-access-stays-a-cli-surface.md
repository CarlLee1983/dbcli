---
status: accepted
date: 2026-08-05
---

# Database access stays a CLI surface

dbcli exposes database access as a command-line surface and does not ship an MCP
server. The reason is not a missing feature in MCP database servers; it is which
party owns the vocabulary an operator writes authorization policy in.

An agent host authorizes a CLI by matching the command string. In Claude Code,
allow rules match the whole string with wildcards at any position, are aware of
shell operators so a rule cannot be widened by chaining, and therefore express a
*gradient*: `dbcli schema *` runs unattended while `dbcli query` still prompts.

The same host authorizes an MCP tool by name. Allow rules accept
`mcp__<server>`, `mcp__<server>__*`, or `mcp__<server>__<tool>`; the documented
reason argument matching is confined to `deny` and `ask` is that "an allow rule
for one parameter value wouldn't establish that the call is safe overall". An
operator can therefore *block* by argument but cannot *permit* by argument. The
expressible policies are "everything from this server runs" and "everything from
this server prompts" — and an operator who is prompted on every read approves
everything, which returns the decision to trusting the server.

An MCP server can regain a gradient only by splitting its surface into separately
named tools, such as `query_readonly` and `query_write`. That moves the policy
into tool naming, and the naming belongs to the server author. Under a CLI the
operator writes the policy in their own settings file, per project, and revises
it without the tool's cooperation. This is the difference the decision rests on,
and it survives any improvement to a competing server, because the author of that
server is still not the operator.

## Evidence: coverage is the property that matters, and only the surface owner can audit it

A safety mechanism is worth what its path coverage is worth, and this project
demonstrated the point against itself. An audit of the five positioning claims
below found five ways a read-looking operation executed a write while bypassing
the configured permission level: MongoDB `$out` / `$merge` on the single-connection
`query` path and in saved snippets, PostgreSQL statement stacking through the
simple query protocol, a data-modifying CTE and `SELECT … INTO` in a snippet
body, a `verify.query` in snippet frontmatter executed verbatim, and the MongoDB
branch of `export`.

The last two were not found by auditing commands. Four independent audits of the
individual commands missed them. They were found by enumerating every call site
that reaches an adapter — an audit that is possible only for the party that owns
the whole surface. An operator of an MCP database server cannot perform it: the
paths are inside the server process.

A sixth was found by an adversarial review of the fixes themselves: PostgreSQL
allows `$` inside an identifier after its first character, so `a$q$` is one
identifier, and reading it as the start of a dollar-quoted string hid everything
up to the next `$q$` from analysis while the server still executed it. That one
predates this work — it defeated the fan-out read-only assertion in 1.47.0, which
was the only statement-splitting guard that existed then.

Two rounds of adversarial review were needed, and the second round found a
bypass in the fix for the first. That is the argument, not a caveat to it: this
class of defect is found by attacking a surface repeatedly, which requires
holding the surface.

The fixes are commits `fcf3502`, `92114d2`, `ee0ed5a` and their successor, and
the enumeration is now a structural contract
(`tests/unit/core/execution-path-contract.test.ts`): a new path to an adapter
fails the suite until it is registered with the gate that proves what it may
execute. The contract does not forbid a new path; it prevents one from being
added silently.

The read-only proof is keyword-based, and its ceiling is recorded in the threat
model: SQL passed as a string to a function (`query_to_xml('DELETE …')`,
`dblink_exec`) or a volatile UDF cannot be detected this way.

## What the CLI surface leaves behind

The claims this decision defends, with their state at the time of writing:

| Claim | State |
| --- | --- |
| The operator owns the authorization vocabulary | Holds — see above |
| The invocation is the unit of review: a human can re-run what the agent ran | Structurally available, **not yet delivered** — see Consequences |
| A failure leaves a plan a human can read: `dbcli recover` renders the artifact as Markdown with a rationale, risk tier, and expectation per step, and `--apply` executes only steps on a code-owned allowlist | Holds |
| Know-how accumulates as files the operator owns: snippets are `.sql` files under `.dbcli-shared/queries/`, committed and reviewed like any other source | Holds |
| The tool outlives the agent: usable by a human, by CI, and by a Makefile, with meaningful exit codes and non-interactive escapes | Holds |

Context cost was considered as a sixth claim and excluded: it was not measured,
and an unmeasured claim does not belong in a decision record.

## Considered options

- Ship an MCP server in addition to the CLI, exposing the same safety mechanisms
  through tools.
- Ship an MCP server instead of the CLI.
- Keep database access a CLI surface and treat host-level authorization of the
  command string as part of the product's contract.

The third option was selected. The first appears free but is not: once an MCP
surface exists, the safety mechanisms have two enforcement paths to cover rather
than one, and the evidence above is that path coverage — not mechanism design —
is where this class of defect lives.

## Consequences

- Command strings must be self-contained for the review claim to hold, and today
  they are not: a connection can be selected by the `DBCLI_CONNECTION`
  environment variable when `--use` is absent, and project storage is keyed by a
  hash of the absolute project path, so an identical string can resolve
  differently on another checkout. Until an emitted command always carries its
  connection and config location explicitly, the second claim is aspirational and
  is recorded here as such.
- Authorization guidance is part of the product. Documentation should show the
  allow and deny rules that produce a useful gradient, because the mechanism only
  reaches operators who write those rules.
- `--recovery` is per-command rather than universal, and is silently skipped for
  multi-connection requests; the recovery claim is bounded accordingly.

**Falsified if:** `src/mcp/` exists, or `package.json` declares an MCP entry
point. Either means this decision has been reversed and this record must be
updated in the same change.

Separately, if Claude Code gains parameter-level `allow` rules for MCP tools,
the primary evidence weakens but the decision stands: the tool surface an
operator writes policy against would still be defined by the server author.

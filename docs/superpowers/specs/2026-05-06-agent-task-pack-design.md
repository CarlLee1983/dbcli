# Agent Task Pack Design

## Intent

dbcli should evolve beyond project-internal feature additions into a CLI-based extension surface for AI agents. The next increment is an **Agent Task Pack** system: AI agents can discover team-defined database task templates and ask dbcli to generate safe, reviewable execution plans.

The first version is deliberately **plan-only**. It does not execute a workflow. Instead, it produces ordered dbcli commands, safety preflights, parameter resolution, and rationale so an agent can proceed step by step under the existing dbcli safety model.

## Priorities

1. **AI agent capability packs**: strengthen `dbcli skill` from a static documentation installer into an agent-oriented discovery and planning entrypoint.
2. **Query/workflow packs**: build on existing saved query snippets so teams can share reusable database diagnostic and operations workflows.

Runtime plugin loading and direct task execution are out of scope for the first version.

## Current Context

Relevant existing extension surfaces:

- `src/commands/skill.ts` installs `assets/SKILL.md` and `assets/reference.md` for AI assistants.
- `src/core/saved-queries/` supports bundled, shared, and local SQL snippets.
- `assets/snippets/` contains built-in diagnostic snippets.
- `.dbcli-shared/queries/` and `.dbcli/queries/` provide team and local query overrides.
- `src/cli.ts` and `src/commands/*` are currently the main compiled-in command extension points.
- Adapter support is compile-time and should not be mixed into this feature.

Agent Task Pack should reuse the proven saved-query layering model rather than inventing a separate package system immediately.

## User-Facing CLI

Add task subcommands under `skill`:

```bash
dbcli skill tasks list
dbcli skill tasks show <task>
dbcli skill tasks plan <task> --param key=value --format markdown
dbcli skill tasks plan <task> --param key=value --format json
```

Supported `list` filters:

```bash
--format table|json
--tag <tag>
--engine <engine>
--source builtin|shared|local
```

A future top-level alias such as `dbcli tasks ...` can be added once the model proves useful, but the first version should keep the agent-oriented entrypoint under `skill`.

## Task Storage Model

Use three task tiers that mirror saved queries:

```text
assets/tasks/                  # builtin tasks shipped with dbcli
.dbcli-shared/tasks/            # shared team tasks, suitable for version control
.dbcli/tasks/                   # local personal tasks
```

Resolution precedence:

```text
builtin < shared < local
```

A shared or local task with the same task name overrides a lower tier. This keeps the mental model aligned with snippets and lets teams customize built-in agent workflows without modifying dbcli source.

## Task File Format

Task files use frontmatter plus optional markdown agent notes. The frontmatter defines machine-readable planning behavior. The markdown body explains human/agent context. Files should use `.md` so the same document is readable by humans and agents.

Example:

```yaml
---
name: diagnose-slow-query
description: Diagnose slow query causes using safe read-only dbcli steps.
tags: [diagnostics, performance, readonly]
engines: [postgres, mysql]
params:
  query:
    type: string
    required: true
    description: The slow SQL query or query fingerprint.
safety:
  mode: plan-only
  requires:
    - blacklist-list
    - schema-check
steps:
  - type: command
    command: blacklist list
    reason: Confirm sensitive tables and columns are protected before inspection.
    risk: readonly
  - type: command
    command: plan "{{query}}"
    reason: Analyze SQL risk without executing the query.
    risk: readonly
  - type: command
    command: q @diag/long-running --format json
    reason: Inspect active long-running queries through a saved diagnostic snippet.
    risk: readonly
---
# Agent Notes

Use this task when the user reports a slow SQL query and wants safe diagnostic next steps.
Do not run write operations.
```

## First-Version Schema

The file format stores `params` as a name-keyed object for readability. The parser normalizes it to an array with the key copied into `name` for stable internal handling.

```ts
type AgentTaskSource = 'builtin' | 'shared' | 'local'
type AgentTaskMode = 'plan-only'
type AgentTaskStepType = 'command'
type AgentTaskRisk = 'readonly' | 'dry-run' | 'write' | 'unknown'

type AgentTaskEngine = 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'elasticsearch'

interface AgentTaskParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description?: string
  default?: string | number | boolean
  enum?: Array<string | number | boolean>
}

interface AgentTaskStep {
  type: AgentTaskStepType
  command: string
  reason?: string
  risk?: AgentTaskRisk
}

interface AgentTask {
  name: string
  description?: string
  tags: string[]
  engines?: AgentTaskEngine[]
  params: AgentTaskParam[]
  safety: {
    mode: AgentTaskMode
    requires?: string[]
  }
  steps: AgentTaskStep[]
  notes?: string
  source: AgentTaskSource
  file: string
}
```

Strictness rules:

- `safety.mode` only accepts `plan-only` in the first version.
- `steps[].type` only accepts `command` in the first version.
- Unknown modes and step types fail parsing instead of being ignored.
- Missing required fields fail parsing with actionable errors.

## Planning Behavior

`dbcli skill tasks plan` resolves one task, applies parameters, validates safety constraints, and outputs a stable plan.

Markdown output should include:

- task name and description
- source and file path
- safety mode and required preflights
- resolved parameters
- ordered steps with resolved dbcli commands
- rationale for each step
- warnings, if any

JSON output should be stable for AI agents:

```json
{
  "name": "diagnose-slow-query",
  "source": "builtin",
  "mode": "plan-only",
  "parameters": {
    "query": "SELECT * FROM orders"
  },
  "steps": [
    {
      "command": "blacklist list",
      "resolvedCommand": "blacklist list",
      "argv": ["blacklist", "list"],
      "reason": "Confirm sensitive tables and columns are protected before inspection.",
      "risk": "readonly"
    }
  ],
  "warnings": []
}
```

The planner must not execute shell commands or database operations.

## Parameter Resolution

Template placeholders use simple double braces:

```text
{{query}}
{{table}}
{{days}}
```

Rules:

- `--param key=value` provides parameter values.
- Missing required parameters fail `plan` instead of emitting an incomplete plan.
- Defaults are applied when optional parameters are omitted.
- Unknown provided parameters produce warnings.
- Output keeps both original `command` and `resolvedCommand`.
- JSON output includes `argv` so agents do not need to split shell strings themselves.

## Agent Workflow

Update the installed skill materials so agents use this flow for database tasks:

1. Discover task templates:

   ```bash
   dbcli skill tasks list --format json
   ```

2. Inspect a selected task:

   ```bash
   dbcli skill tasks show <task>
   ```

3. Generate a plan:

   ```bash
   dbcli skill tasks plan <task> --param key=value --format json
   ```

4. Execute resulting commands one at a time, preserving existing dbcli safety rules:

   ```bash
   dbcli blacklist list
   dbcli schema <table> --format json
   dbcli query ... --format json
   ```

The generated plan guides the agent; it does not override blacklist, schema, dry-run, or confirmation requirements.

## Internal Module Design

Add a core module parallel to saved queries:

```text
src/core/agent-tasks/
  index.ts
  types.ts
  task-paths.ts
  parser.ts
  loader.ts
  resolver.ts
  planner.ts
```

Responsibilities:

- `types.ts`: exported task, step, parameter, source, and plan types.
- `task-paths.ts`: resolves `assets/tasks`, `.dbcli-shared/tasks`, and `.dbcli/tasks`.
- `parser.ts`: parses frontmatter and markdown notes, then validates the schema.
- `loader.ts`: scans task directories and loads valid task definitions.
- `resolver.ts`: applies source precedence and filters by task name/engine/source.
- `planner.ts`: validates parameters, resolves templates, builds markdown/json plan output.

Add CLI command wiring in a separate command module:

```text
src/commands/skill-tasks.ts
```

`src/commands/skill.ts` should keep its existing install behavior. The task command implementation should be separate to avoid making `skill.ts` a large mixed-responsibility file.

## Testing Strategy

Unit tests:

```text
tests/unit/agent-tasks/parser.test.ts
tests/unit/agent-tasks/loader.test.ts
tests/unit/agent-tasks/resolver.test.ts
tests/unit/agent-tasks/planner.test.ts
```

Coverage goals:

- valid task parses successfully
- missing `name` fails
- invalid `safety.mode` fails
- invalid `steps[].type` fails
- builtin/shared/local override works
- engine/source/tag filtering works
- required parameter omission fails `plan`
- optional default parameters resolve correctly
- unknown provided parameters create warnings
- `{{param}}` replacement works
- JSON plan includes stable `steps[].argv`
- markdown plan includes safety, params, steps, reasons, and warnings

CLI tests:

```text
tests/unit/commands/skill-tasks.test.ts
```

Validate:

- `skill tasks list --format json`
- `skill tasks show <task>`
- `skill tasks plan <task> --param ... --format json`

## Documentation Updates

Update:

```text
assets/SKILL.md
assets/reference.md
docs/feature-matrix.md
assets/tasks/README.md
```

The skill materials must explicitly instruct agents to prefer `dbcli skill tasks list --format json` and `dbcli skill tasks plan ... --format json` when a user asks for a database workflow rather than inventing a workflow from memory.

## Non-Goals

The first version does not include:

- `dbcli skill tasks run`
- arbitrary shell execution
- remote task package installation
- runtime plugin loading
- adapter/plugin SDK changes
- automatic database writes
- replacing existing `queries` or `q @name`

## Verification Plan

After implementation, run:

```bash
bun test
bun run typecheck
bun run lint
```

For focused development, also run the new agent-task unit tests and command tests directly with `bun test`.

## Open Extension Points

These are intentional future directions, not first-version requirements:

- top-level `dbcli tasks` alias
- `tasks install` for remote or registry-backed packs
- richer step types after safety review
- signed or trusted task packs
- controlled `run` mode with explicit confirmation gates
- task-pack metadata for teams and versions

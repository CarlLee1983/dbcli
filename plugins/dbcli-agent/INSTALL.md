# dbcli Agent Plugin Installation

This guide explains how to install the bundled dbcli agent skill for Codex,
Claude Code, Antigravity, and Cursor.

## What Gets Installed

The plugin bundle contains one canonical skill:

- `skills/dbcli/SKILL.md`
- `skills/dbcli/reference.md`

The skill tells agents how to use dbcli safely, including permission checks,
blacklist rules, schema confirmation, dry runs, recovery envelopes, and the
`bunx @carllee1983/dbcli <command>` fallback when `dbcli` is not globally
installed.

## Install All Supported Agent Targets

Run this from the dbcli repository root:

```bash
plugins/dbcli-agent/scripts/install-skills.sh all
```

This installs the bundled skill into:

| Target | Installed files |
| --- | --- |
| Codex | `~/.codex/skills/dbcli/SKILL.md` and `reference.md` |
| Claude Code | `~/.claude/skills/dbcli/SKILL.md` and `reference.md` |
| Antigravity | `~/.gemini/antigravity-cli/skills/dbcli/SKILL.md` and `reference.md` |
| Cursor | `.cursor/rules/dbcli.mdc` and `.cursor/skills/dbcli/reference.md` |

## Install One Target

```bash
plugins/dbcli-agent/scripts/install-skills.sh codex
plugins/dbcli-agent/scripts/install-skills.sh claude
plugins/dbcli-agent/scripts/install-skills.sh antigravity
plugins/dbcli-agent/scripts/install-skills.sh agy
plugins/dbcli-agent/scripts/install-skills.sh cursor
```

`agy` is an alias for `antigravity`.

## Codex Plugin Install

Codex can also install this directory as a plugin because it includes:

```text
plugins/dbcli-agent/.codex-plugin/plugin.json
```

When installed as a Codex plugin, Codex reads the skill from:

```text
plugins/dbcli-agent/skills/dbcli/
```

The `install-skills.sh codex` command is still useful when you want the same
skill available through Codex's regular user skill directory.

## Optional: Install the dbcli CLI

The skill can run dbcli through `bunx`, so a global CLI install is not required.
For a persistent `dbcli` executable in `PATH`, run:

```bash
plugins/dbcli-agent/scripts/install-dbcli.sh
```

The installer prefers Bun:

```bash
bun install -g @carllee1983/dbcli
```

If Bun is unavailable but npm exists, it falls back to:

```bash
npm install -g @carllee1983/dbcli
```

## Verify Installation

Check the files for the targets you installed:

```bash
test -f ~/.codex/skills/dbcli/SKILL.md
test -f ~/.claude/skills/dbcli/SKILL.md
test -f ~/.gemini/antigravity-cli/skills/dbcli/SKILL.md
test -f .cursor/rules/dbcli.mdc
```

Then start a new agent session so the tool reloads skills.

## Keep Plugin Assets In Sync

The plugin skill files are copies of the package sources:

- `assets/SKILL.md`
- `assets/reference.md`

After editing either source file, refresh and check the plugin copies:

```bash
bun run plugin:sync
bun run plugin:check
```

## Troubleshooting

If an agent cannot run `dbcli`, first check whether Bun is available:

```bash
bunx @carllee1983/dbcli --version
```

If that works, the skill can use dbcli without a global install. If it fails,
install Bun or use the persistent CLI installer above.

Cursor installs are project-local. Run `install-skills.sh cursor` from the
project where Cursor should see `.cursor/rules/dbcli.mdc`.

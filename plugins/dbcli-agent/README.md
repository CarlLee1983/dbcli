# dbcli Agent Plugin

Agent skill bundle for dbcli.

Full installation instructions: [INSTALL.md](./INSTALL.md).

This repo can be installed like the Ponytail plugin. Use the command set for
your agent:

## Claude Code

```text
/plugin marketplace add CarlLee1983/dbcli
/plugin install dbcli-agent@dbcli-agent
```

## Codex

```bash
codex plugin marketplace add CarlLee1983/dbcli
```

Then open `/plugins` and install `dbcli-agent`.

## GitHub Copilot CLI

```bash
copilot plugin marketplace add CarlLee1983/dbcli
copilot plugin install dbcli-agent@dbcli-agent
```

## Antigravity CLI

```bash
agy plugin install https://github.com/CarlLee1983/dbcli
```

## Cursor

Cursor is instruction-file based. Use the Cursor section in
[INSTALL.md](./INSTALL.md#cursor).

Installing it as a plugin makes the `dbcli` skill available from
`skills/dbcli/SKILL.md`, with the full command reference next to it.

The same bundled skill files can also be installed into Claude Code,
Antigravity, and Cursor without requiring a global `dbcli` install:

```bash
plugins/dbcli-agent/scripts/install-skills.sh all
plugins/dbcli-agent/scripts/install-skills.sh codex
plugins/dbcli-agent/scripts/install-skills.sh claude
plugins/dbcli-agent/scripts/install-skills.sh antigravity
plugins/dbcli-agent/scripts/install-skills.sh agy
plugins/dbcli-agent/scripts/install-skills.sh cursor
```

Install targets:

- Codex: `~/.codex/skills/dbcli/`
- Claude Code: `~/.claude/skills/dbcli/`
- Antigravity: `~/.gemini/antigravity-cli/skills/dbcli/`
- Cursor: `.cursor/rules/dbcli.mdc` plus `.cursor/skills/dbcli/reference.md`

The skill uses `dbcli` when it is already installed and falls back to
`bunx @carllee1983/dbcli <command>` when the executable is not on `PATH`.

For a persistent global CLI, run:

```bash
plugins/dbcli-agent/scripts/install-dbcli.sh
```

The plugin skill files are copied from `assets/SKILL.md` and
`assets/reference.md`. Refresh them with:

```bash
bun run plugin:sync
```

# dbcli Agent Plugin Installation

This repo follows the same installation shape as
`DietrichGebert/ponytail`: the repository root contains the plugin metadata, a
marketplace file, and portable agent skill/rule copies.

## What Gets Installed

The canonical skill files are:

- `skills/dbcli/SKILL.md`
- `skills/dbcli/reference.md`

The skill tells agents how to use dbcli safely, including permission checks,
blacklist rules, schema confirmation, dry runs, recovery envelopes, and the
`bunx @carllee1983/dbcli <command>` fallback when `dbcli` is not globally
installed.

## Claude Code

In Claude Code:

```text
/plugin marketplace add CarlLee1983/dbcli
/plugin install dbcli-agent@dbcli-agent
```

Start a new Claude Code session after install so the skill is reloaded.

## GitHub Copilot CLI

From a shell:

```bash
copilot plugin marketplace add CarlLee1983/dbcli
copilot plugin install dbcli-agent@dbcli-agent
```

In an interactive Copilot CLI session, use the slash equivalents:

```text
/plugin marketplace add CarlLee1983/dbcli
/plugin install dbcli-agent@dbcli-agent
```

For instruction-only project fallback, this repo also ships:

```text
.github/skills/dbcli/SKILL.md
.github/skills/dbcli/reference.md
```

## Codex

From a shell:

```bash
codex plugin marketplace add CarlLee1983/dbcli
codex
```

Then open `/plugins`, select the dbcli Agent marketplace, and install
`dbcli-agent`. Start a new thread after install.

The same marketplace install also applies to the Codex desktop app after it
reloads plugin metadata.

## Antigravity CLI

Antigravity (`agy`) can install from the GitHub repository URL:

```bash
agy plugin install https://github.com/CarlLee1983/dbcli
```

The repo also includes `gemini-extension.json`, matching the extension layout
used by Gemini/Antigravity-style agents.

## Cursor

> **Current status: manual install.** `dbcli-agent` is not yet indexed in
> Cursor's plugin marketplace, so `/add-plugin dbcli-agent` in Cursor Agent chat
> will not find it. Use one of the manual fallbacks below. The `/add-plugin`
> command only works once the plugin has been indexed (see the submission steps
> that follow).

Once the plugin is indexed, Cursor can install it from Cursor Agent chat:

```text
/add-plugin dbcli-agent
```

Or search for `dbcli-agent` in Cursor's plugin marketplace.

This repository includes Cursor plugin metadata at:

```text
.cursor-plugin/plugin.json
```

To get `/add-plugin` working, submit the repo for Cursor marketplace
review/indexing:

1. Push this repository to GitHub and keep it public.
2. Keep the single-plugin layout at the repository root:
   `.cursor-plugin/plugin.json` plus `skills/dbcli/`.
3. Confirm the manifest name is lowercase kebab-case (`dbcli-agent`), the skill
   files carry YAML frontmatter, `README.md` exists at the repo root, and all
   manifest paths are relative with no `..` or absolute paths.
4. Submit the repository at <https://cursor.com/marketplace/publish>. This is the
   current channel — the marketplace launched with Cursor 2.5 (2026-02-17) and
   every plugin is manually reviewed and must be open source. Do **not** email
   `kniparko@anysphere.com`; that address came from an older plugin template and
   is not the submission path.
5. After the plugin is reviewed and listed, users can install from Cursor Agent
   chat with `/add-plugin dbcli-agent` or by searching the Cursor marketplace.

The repo also keeps an instruction-file fallback for projects that want to
vendor the dbcli rule and reference directly.

### Fallback A: from an existing dbcli checkout

Run this from the target project where Cursor should see dbcli:

```bash
DBCLI_REPO=/path/to/dbcli
mkdir -p .cursor/rules .cursor/skills/dbcli
cp "$DBCLI_REPO/.cursor/rules/dbcli.mdc" .cursor/rules/dbcli.mdc
cp "$DBCLI_REPO/.cursor/skills/dbcli/reference.md" .cursor/skills/dbcli/reference.md
```

### Fallback B: clone dbcli first

```bash
git clone https://github.com/CarlLee1983/dbcli.git /tmp/dbcli-agent-plugin
cd /path/to/your/project
mkdir -p .cursor/rules .cursor/skills/dbcli
cp /tmp/dbcli-agent-plugin/.cursor/rules/dbcli.mdc .cursor/rules/dbcli.mdc
cp /tmp/dbcli-agent-plugin/.cursor/skills/dbcli/reference.md .cursor/skills/dbcli/reference.md
```

### Fallback C: from this repo checkout

When your shell is already inside the dbcli checkout, the local installer writes
the Cursor files into the current working directory:

```bash
plugins/dbcli-agent/scripts/install-skills.sh cursor
```

Open or reload the target project in Cursor after installing fallback files.
Cursor should read:

```text
.cursor/rules/dbcli.mdc
.cursor/skills/dbcli/reference.md
```

## Local Checkout Installer

If you are working from a checkout and want to install the skill into all
supported local targets at once:

```bash
plugins/dbcli-agent/scripts/install-skills.sh all
```

Single-target installs:

```bash
plugins/dbcli-agent/scripts/install-skills.sh codex
plugins/dbcli-agent/scripts/install-skills.sh claude
plugins/dbcli-agent/scripts/install-skills.sh copilot
plugins/dbcli-agent/scripts/install-skills.sh antigravity
plugins/dbcli-agent/scripts/install-skills.sh agy
plugins/dbcli-agent/scripts/install-skills.sh cursor
```

`agy` is an alias for `antigravity`.

Install targets:

| Target | Installed files |
| --- | --- |
| Codex | `~/.codex/skills/dbcli/SKILL.md` and `reference.md` |
| Claude Code | `~/.claude/skills/dbcli/SKILL.md` and `reference.md` |
| GitHub Copilot CLI | `.github/skills/dbcli/SKILL.md` and `reference.md` |
| Antigravity | `~/.gemini/antigravity-cli/skills/dbcli/SKILL.md` and `reference.md` |
| Cursor | `.cursor/rules/dbcli.mdc` and `.cursor/skills/dbcli/reference.md` |

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

For local script installs, check the files for the targets you installed:

```bash
test -f ~/.codex/skills/dbcli/SKILL.md
test -f ~/.claude/skills/dbcli/SKILL.md
test -f ~/.gemini/antigravity-cli/skills/dbcli/SKILL.md
test -f .github/skills/dbcli/SKILL.md
test -f .cursor/rules/dbcli.mdc
```

For marketplace installs, open a new agent session and confirm the `dbcli`
skill is listed or can be invoked by a database task.

## Keep Plugin Assets In Sync

The portable copies are generated from:

- `assets/SKILL.md`
- `assets/reference.md`

After editing either source file, refresh and check every copy:

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

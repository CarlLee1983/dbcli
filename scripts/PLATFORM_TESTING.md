# AI Platform Integration Testing Checklist

After running `bun run build` and `scripts/validate-skill.sh`, perform manual testing on each platform.

## Claude Code (Anthropic)

- [ ] Install: `dbcli skill --install claude`
- [ ] Verify file: `cat ~/.claude/skills/SKILL.md` (should exist)
- [ ] Verify content: File contains "dbcli query", "## Commands"
- [ ] Open Claude Code IDE
- [ ] In Claude Code chat, say: "What tables are available in the database?"
- [ ] Claude Code should invoke: `dbcli list` or `dbcli schema`
- [ ] Result should show database schema

## Gemini CLI (Google)

- [ ] Install: `dbcli skill --install gemini`
- [ ] Verify: Gemini config location has SKILL.md
- [ ] Start Gemini: `gemini start` (if installed)
- [ ] In chat, request: "Query the users table"
- [ ] Gemini should invoke: `dbcli query "SELECT * FROM users"`
- [ ] Result should show query output

## GitHub Copilot CLI

- [ ] Install: `dbcli skill --install copilot`
- [ ] Verify: Copilot config has SKILL.md
- [ ] If Copilot CLI installed: `copilot -d "Query database"` or preview
- [ ] Result should recognize dbcli commands

## Cursor IDE

- [ ] Install: `dbcli skill --install cursor`
- [ ] Verify file: `cat ~/.cursor/skills/SKILL.md`
- [ ] Open Cursor editor
- [ ] Open Cursor Composer (AI assistant panel)
- [ ] Request: "Insert a new user into the database"
- [ ] Cursor should invoke: `dbcli insert users --data ...`
- [ ] Result should show insertion confirmation

## Notes

- Some platforms (Gemini, Copilot) may not be installed in dev environment; skip if unavailable
- Validation script (`validate-skill.sh`) checks CLI-level correctness; manual testing verifies IDE integration
- If skill installation fails on any platform, check that skill format matches platform expectations (all use YAML frontmatter)

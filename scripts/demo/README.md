# Agent demo video

Scripts that record and cut the agent demo shown in the `#safety` section of
`docs/dbcli-intro.html` and `docs/dbcli-intro.en.html`, and linked from both
READMEs. The video is a real Claude Code session, not a mock-up.

## What it shows

A throwaway database, `dbcli_demo`, is created on the `postgres` service of
`docker-compose.test.yml` (kept apart from `dbcli_test`, so tables left by
integration tests never appear on screen) and seeded with `customers` (including `password_hash`) and `orders`
(`seed.sql`). dbcli is initialised there with `--permission query-only`, and
`customers.password_hash` is blacklisted. Claude Code runs with
`DBCLI_AGENT_MODE=1` and is given one request that both reads and writes
(`DEMO_PROMPT` in `record.sh`). It inspects the schema, queries (the
blacklisted column is omitted with dbcli's security notice), is refused on the
write, and reports that instead of raising its own permission.

Two settings shape how the session looks, not what the agent decides:
`--verbose` shows tool output instead of collapsing it, and an appended system
prompt asks for English replies and one dbcli command per Bash call without
redirecting its output, so each result stays on screen.

## Re-recording

Needs docker, [vhs](https://github.com/charmbracelet/vhs), tmux, zsh, ffmpeg 7
or later (for `-/filter_complex`) with libx264 and libvpx, `cwebp`, a built
`dbcli` on `PATH`, and a logged-in Claude Code. The session loads the
operator's own Claude Code user settings (hooks, status line) along with the
globally installed dbcli skill; that is what makes it a real session, and also
why two recordings never look identical.

```sh
scripts/demo/record.sh   # setup.sh, then a recorded session → scripts/demo/out/raw.mp4
scripts/demo/edit.sh     # cuts.txt → docs/assets/demo/dbcli-agent-demo.{webm,mp4,-poster.webp,-thumb.webp}
```

- `setup.sh` runs before recording starts. It starts Postgres, recreates and
  seeds `dbcli_demo`, recreates `$DEMO_DIR` (default `~/dbcli-demo`; any other
  name not starting with `dbcli-demo` is refused, since the directory is
  deleted), runs `dbcli init` and adds the blacklist entry, so none of that, nor
  the password, appears on screen.
- `record.sh` starts Claude Code in a tmux session; `drive.sh` types the
  request and waits for the turn to end, and vhs (`demo.tape`) only records.
  If Claude Code still asks for a permission, `drive.sh` answers Yes only for a
  read-only dbcli command (`schema`, `list`, `query`, `blacklist list`) and logs
  it to `out/drive.log`; any other prompt aborts the recording, so the video
  can never show an approval the agent was not entitled to.
- An agent run is not deterministic. Check the frames of `out/raw.mp4`, then
  rewrite `cuts.txt` for the new recording: every sped-up segment gets a speed
  label and every freeze a `paused` label, and `POSTER_AT` (seconds into
  `raw.mp4`) picks the poster frame. Only `2` and `4` have label images; a new
  factor needs `labels/speedN.png` plus an entry in `inputs` and `label` in
  `edit.sh`. Stop the cut before Claude Code's grey prompt suggestion appears in
  the input box, since it reads like a reply from the user.

`setup.sh` leaves the demo directory and its dbcli project config under
`~/.config/dbcli/projects/` in place for the next run; remove both by hand when
you no longer need them.

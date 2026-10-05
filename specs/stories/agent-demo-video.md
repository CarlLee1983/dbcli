# Show a recorded agent session in the intro pages and READMEs

## Goal

A reader of the intro pages or the READMEs can watch a short, real Claude Code
session in which an agent uses the dbcli skill and runs into dbcli's
guardrails, instead of only reading about them. Today the guardrails are
described in text only: the `#safety` section of `docs/dbcli-intro.html:305-318`
(and its English counterpart `docs/dbcli-intro.en.html:305-318`) lists four
layers as cards, and neither README embeds any image or video.

The recording is a real session, not a mock-up. A throwaway Postgres from
`docker-compose.test.yml` (port 5433, tmpfs) is seeded with demo tables
`customers` (including a `password_hash` column) and `orders`; dbcli is
initialised against it with `--permission query-only`;
`customers.password_hash` is blacklisted; and Claude Code runs with
`DBCLI_AGENT_MODE=1` and without `DBCLI_LANG`, so dbcli prints its English
messages (`src/i18n/message-loader.ts:32`). Both intro pages share the one
video. Given one natural-language request that asks for both a
read and a write, the agent inspects the schema, runs a query whose output
omits the blacklisted column with dbcli's security notice, attempts the write,
is refused by the query-only permission, and reports the refusal instead of
changing its own permission. Waiting segments are sped up and labelled as such.

The video sits in the `#safety` section of both intro pages, below the cards.
The hero is untouched, because `tests/docs/intro-pages.test.ts:84` forbids
terminal-like elements there. GitHub READMEs do not play repository video
files, so each README shows a thumbnail that links to its locale's intro page
at `#safety` on GitHub Pages (`https://carllee1983.github.io/dbcli/`, served
from `/docs` on `main`). The setup and recording scripts and the seed SQL are
committed so the video can be re-recorded after the CLI output changes.

## Out of Scope

- Changing dbcli behaviour, messages, the skill text (`skills/dbcli/`,
  `assets/SKILL.md`, `assets/reference.md`), or `docker-compose.test.yml`.
- Demonstrating `--dry-run` writes, `export`, `recover`, or connections other
  than Postgres.
- An animated GIF in the READMEs, or hosting the video on a third-party video
  service or CDN.
- Updating the operator's globally installed skill copy; that is a local step
  before recording, not part of this change.
- Changing the hero or any section other than `#safety` in the intro pages,
  and any other documentation page (`docs/guides/`, `docs/user/`).

## Acceptance Criteria

1. `docs/assets/demo/` contains `dbcli-agent-demo.webm`,
   `dbcli-agent-demo.mp4`, a poster image `dbcli-agent-demo-poster.webp`, and a
   README thumbnail `dbcli-agent-demo-thumb.webp`. Each video file is at most
   4 MB, and `ffprobe` reports a duration between 40 and 70 seconds for both.
2. Frames extracted from the video show, in this order: the natural-language
   request typed into Claude Code; the agent running `dbcli schema`; query
   output containing `Security: 1 column(s) were omitted based on your
   blacklist`; a refusal containing `requires read-write permission or higher
   (current level: query-only)`; and the agent's final reply saying the write
   was not performed. The completion report lists the timestamp of each frame.
3. Every sped-up segment of the video shows a visible speed label (for
   example `×8`) for the whole segment.
4. In the recording script under `scripts/demo/`, the setup (starting the
   Postgres service, seeding, `dbcli init`, `blacklist add`) completes before
   the step that starts recording, and the first frame of the video shows the
   Claude Code welcome screen.
5. In both `docs/dbcli-intro.html` and `docs/dbcli-intro.en.html`, `section#safety`
   contains exactly one `<video>` with the `controls`, `muted` and `playsinline`
   attributes, no `autoplay` attribute, `poster` pointing at the poster image, and
   two `<source>` children: the webm first, then the mp4. A caption next to the
   video, in the page's language, states that it is a real recording and that
   waiting segments are sped up.
6. Each intro page starts playback when the video scrolls into view, at most
   once, and does not start it when `prefers-reduced-motion: reduce` matches.
   This is observed in a browser by checking `video.paused` after scrolling it
   into view, with and without reduced motion emulated.
7. `tests/docs/intro-pages.test.ts` has a test that fails without the video
   markup and asserts criterion 5 for both locales.
8. `README.md` shows the thumbnail as an image linking to
   `https://carllee1983.github.io/dbcli/dbcli-intro.en.html#safety`, and
   `README.zh-TW.md` shows it linking to
   `https://carllee1983.github.io/dbcli/dbcli-intro.html#safety`. Each has alt
   text in its own language.
9. `scripts/demo/` contains the seed SQL, the setup script (starting the
   Postgres service, seeding, `dbcli init`, `blacklist add`), and the recording
   script. Its README states the commands that re-record the video and what
   each script needs (docker, vhs, tmux, ffmpeg, a logged-in Claude Code).
10. At a 390 px wide viewport, neither intro page scrolls horizontally
    (`document.documentElement.scrollWidth` equals the viewport width).
11. `git diff --name-only main...HEAD` lists only files under
    `docs/assets/demo/` and `scripts/demo/`, `docs/dbcli-intro.html`,
    `docs/dbcli-intro.en.html`, `README.md`, `README.zh-TW.md`,
    `tests/docs/intro-pages.test.ts`, and this Story file
    (`specs/stories/agent-demo-video.md`).
12. `make verify` passes.

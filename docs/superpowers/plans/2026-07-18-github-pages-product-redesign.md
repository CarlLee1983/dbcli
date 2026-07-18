# dbcli GitHub Pages Product Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Traditional Chinese and English GitHub Pages intro pages into a friendly, outcome-led product site that demonstrates AI Agent efficiency and dbcli safety through a “conversation × guardrails” workflow.

**Architecture:** Keep both pages as dependency-free static HTML published from `docs/`. Each locale owns its copy but shares the same semantic section IDs, component classes, design tokens, responsive rules, and lightweight progressive enhancement. A Bun test parses both files and enforces structure, locale parity, accessibility hooks, asset integrity, and the absence of an install-first hero.

**Tech Stack:** HTML5, CSS3, minimal browser JavaScript, Bun test, `happy-dom`, GitHub Pages.

## Global Constraints

- Use Bun for every local command and test.
- Preserve GitHub Pages publishing from `main:/docs`.
- Keep `docs/dbcli-intro.html` and `docs/dbcli-intro.en.html` in structural and feature parity.
- Do not add a frontend framework, runtime dependency, server feature, or data collection.
- The first viewport must communicate efficiency and safety through a real workflow, not installation commands or an API-style command list.
- Use the approved friendly product style: cream background, soft orange and mist blue accents, dark brown-black text, generous whitespace, rounded cards, thin borders, and low-contrast shadows.
- Use semantic HTML, keyboard-visible focus styles, touch-sized controls, meaningful image alternatives, and reduced-motion support.
- Use relative asset URLs that work both from a local file preview and the GitHub Pages subpath.
- Preserve all currently supported databases, AI platforms, installation routes, safety capabilities, and language links.
- Avoid model-authored SVG artwork and unnecessary large assets.

---

### Task 1: Encode the product-page contract

**Files:**
- Create: `tests/docs/intro-pages.test.ts`
- Read: `docs/superpowers/specs/2026-07-18-github-pages-product-redesign-design.md`
- Test: `tests/docs/intro-pages.test.ts`

**Interfaces:**
- Consumes: the two locale HTML files as UTF-8 text.
- Produces: `loadIntroPage(path): Promise<{ html: string; document: Document }>` and contract tests used by both locale implementations.

- [ ] **Step 1: Write the failing structural tests**

```ts
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const pages = [
  { locale: "zh-TW", path: "docs/dbcli-intro.html", counterpart: "dbcli-intro.en.html" },
  { locale: "en", path: "docs/dbcli-intro.en.html", counterpart: "dbcli-intro.html" },
] as const;

async function loadIntroPage(path: string) {
  const html = await Bun.file(path).text();
  const window = new Window();
  window.document.write(html);
  return { html, document: window.document };
}

describe.each(pages)("$locale intro page", ({ path, counterpart }) => {
  test("uses the approved semantic product-page structure", async () => {
    const { document } = await loadIntroPage(path);
    expect(document.querySelector("header.site-header")).not.toBeNull();
    expect(document.querySelector("main")).not.toBeNull();
    expect(document.querySelector("section#workflow")).not.toBeNull();
    expect(document.querySelector("section#efficiency")).not.toBeNull();
    expect(document.querySelector("section#safety")).not.toBeNull();
    expect(document.querySelector("section#platforms")).not.toBeNull();
    expect(document.querySelector("section#quickstart")).not.toBeNull();
    expect(document.querySelector("section#faq")).not.toBeNull();
    expect(document.querySelector("footer")).not.toBeNull();
  });

  test("leads with workflow value instead of installation", async () => {
    const { document } = await loadIntroPage(path);
    const hero = document.querySelector(".hero");
    expect(hero?.querySelector(".conversation-guardrails")).not.toBeNull();
    expect(hero?.querySelector('a[href="#workflow"]')).not.toBeNull();
    expect(hero?.querySelector("pre, .terminal, .install-command")).toBeNull();
  });

  test("has accessible navigation and motion fallback", async () => {
    const { html, document } = await loadIntroPage(path);
    expect(document.querySelector('a[href="#main-content"]')).not.toBeNull();
    expect(document.querySelector("nav[aria-label]")).not.toBeNull();
    expect(html).toContain(":focus-visible");
    expect(html).toContain("prefers-reduced-motion: reduce");
  });

  test("links to the counterpart locale with a relative URL", async () => {
    const { document } = await loadIntroPage(path);
    expect(document.querySelector(`a[href="./${counterpart}"]`)).not.toBeNull();
  });
});

test("locale pages expose the same section and component contract", async () => {
  const zh = await loadIntroPage("docs/dbcli-intro.html");
  const en = await loadIntroPage("docs/dbcli-intro.en.html");
  const ids = (document: Document) =>
    [...document.querySelectorAll("main section[id]")].map((section) => section.id);
  expect(ids(zh.document)).toEqual(ids(en.document));
  expect(zh.document.querySelectorAll(".workflow-step").length).toBe(
    en.document.querySelectorAll(".workflow-step").length,
  );
  expect(zh.document.querySelectorAll(".safety-layer").length).toBe(
    en.document.querySelectorAll(".safety-layer").length,
  );
  expect(zh.document.querySelectorAll(".platform-chip").length).toBe(
    en.document.querySelectorAll(".platform-chip").length,
  );
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `bun test tests/docs/intro-pages.test.ts`

Expected: FAIL because the existing pages do not contain `header.site-header`, `#workflow`, `#efficiency`, or `.conversation-guardrails`.

- [ ] **Step 3: Commit the failing contract**

```bash
git add tests/docs/intro-pages.test.ts
git commit -m "test: define intro page product contract"
```

### Task 2: Redesign the Traditional Chinese page

**Files:**
- Modify: `docs/dbcli-intro.html`
- Test: `tests/docs/intro-pages.test.ts`

**Interfaces:**
- Consumes: the semantic IDs and component classes defined in Task 1.
- Produces: the canonical Traditional Chinese content and visual implementation that the English page mirrors.

- [ ] **Step 1: Replace the page shell and design tokens**

Replace the existing document with semantic `header`, `main`, and `footer` regions. Define these exact root tokens and shared foundations:

```css
:root {
  --cream: #fffaf3;
  --paper: #ffffff;
  --ink: #28231f;
  --muted: #716a63;
  --orange: #e8673f;
  --orange-soft: #fff0df;
  --blue: #5f7fbc;
  --blue-soft: #edf3ff;
  --green: #28745a;
  --green-soft: #e4f3ec;
  --line: #e9dfd3;
  --shadow: 0 20px 60px rgba(83, 61, 42, 0.09);
  --radius-lg: 28px;
  --radius-md: 18px;
  --content: 1180px;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  background: var(--cream);
  font-family: Inter, "Noto Sans TC", "PingFang TC", system-ui, sans-serif;
}
:focus-visible { outline: 3px solid var(--blue); outline-offset: 4px; }
section[id] { scroll-margin-top: 92px; }
```

Add a skip link, sticky `header.site-header`, brand, anchor links, locale link, and primary “開始使用” button. Keep the GitHub URL relative to the repository’s public URL only where a relative site URL is impossible.

- [ ] **Step 2: Build the outcome-led hero**

Use this semantic structure and approved copy:

```html
<section class="hero" aria-labelledby="hero-title">
  <div class="hero-copy">
    <p class="eyebrow">快一點，也安心一點</p>
    <h1 id="hero-title">你說目標，Agent 完成。<br>資料安全交給 dbcli。</h1>
    <p class="hero-lead">從分析到互動式報表，Agent 有效率地把資料任務做完；dbcli 全程確認結構、保護敏感資料並守住操作界線。</p>
    <div class="hero-actions">
      <a class="button button-primary" href="#workflow">看看它怎麼運作</a>
      <a class="button button-secondary" href="https://github.com/CarlLee1983/dbcli">前往 GitHub</a>
    </div>
  </div>
  <div class="conversation-guardrails" aria-label="使用者對話與 dbcli 安全防護示意">
    <article class="conversation-panel">
      <p class="panel-label">你與 Agent</p>
      <div class="message message-user">找出本月流失最多的方案，整理成圖表。</div>
      <div class="message message-agent">完成。企業方案流失率上升 8.4%，並已產生可分享報表。</div>
    </article>
    <article class="guardrails-panel">
      <p class="panel-label">dbcli 在背後</p>
      <ul class="guardrail-list">
        <li>確認實際資料結構</li>
        <li>隱藏敏感欄位</li>
        <li>限制查詢範圍</li>
        <li>驗證結果並留下紀錄</li>
      </ul>
    </article>
  </div>
</section>
```

The hero must contain no installation command, terminal, command list, or fear-led warning.

- [ ] **Step 3: Build the real workflow section**

Create `section#workflow` with five `.workflow-step` articles in this order:

1. 描述成果 — natural-language request.
2. 確認結構 — `schema` prevents guessed columns.
3. 套用防護 — blacklist, permission, and query limits.
4. 執行與驗證 — query plus result verification and recovery.
5. 交付結果 — interactive report output.

Include one collapsed native `<details>` element titled “看看 Agent 背後執行了什麼” containing the representative command chain. Do not expose credentials or invent unsupported flags.

- [ ] **Step 4: Build efficiency, safety, and platform sections**

Create:

- `section#efficiency` with three `.value-card` articles for one-request workflows, schema/snippet reuse, and guided diagnosis/report delivery.
- `section#safety` with four `.safety-layer` articles for credential isolation, blacklists, permission/dry-run controls, and verification/recovery/audit.
- `section#platforms` with `.platform-chip` elements for PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Elasticsearch, Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and Antigravity.

Use concise outcome-first copy. Put command names in small supporting labels rather than headings.

- [ ] **Step 5: Build quickstart, FAQ, and footer**

Create `section#quickstart` with Plugin／Skill as the primary route and CLI as the secondary route. Preserve only commands verified by the current page and repository documentation:

```text
/plugin marketplace add CarlLee1983/dbcli
/plugin install dbcli@carllee1983-dbcli

bunx @carllee1983/dbcli init
dbcli skill --install codex
```

Retain the current supported platform instructions, GitHub link, full documentation link, FAQ answers, and language switch. Add copy buttons with `aria-label` and a non-JavaScript fallback where command text remains selectable.

- [ ] **Step 6: Add responsive and progressive-enhancement behavior**

Implement:

```css
@media (max-width: 820px) {
  .nav-links { display: none; }
  .hero { grid-template-columns: 1fr; }
  .conversation-guardrails { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Use lightweight JavaScript only for copy buttons and optional reveal-state classes. Set copied feedback through button text and `aria-live="polite"`; restore the original label after 1.5 seconds.

- [ ] **Step 7: Run the locale-specific tests**

Run: `bun test tests/docs/intro-pages.test.ts --test-name-pattern "zh-TW"`

Expected: all Traditional Chinese page tests PASS; the cross-locale parity test may remain failing until Task 3.

- [ ] **Step 8: Commit the Traditional Chinese redesign**

```bash
git add docs/dbcli-intro.html
git commit -m "docs: redesign Traditional Chinese intro page"
```

### Task 3: Mirror the redesign in English

**Files:**
- Modify: `docs/dbcli-intro.en.html`
- Test: `tests/docs/intro-pages.test.ts`

**Interfaces:**
- Consumes: the exact IDs, class names, component counts, visual tokens, responsive rules, and interactions implemented in Task 2.
- Produces: an English semantic mirror with natural English product copy.

- [ ] **Step 1: Port the shared page structure and styles**

Copy the semantic structure, class names, CSS tokens, media queries, and progressive-enhancement script from `docs/dbcli-intro.html`. Set `lang="en"` and preserve `./dbcli-intro.html` as the locale link.

- [ ] **Step 2: Translate the hero by meaning**

Use:

```html
<p class="eyebrow">Move faster. Stay in control.</p>
<h1 id="hero-title">Name the outcome. Your agent delivers.<br>dbcli keeps the data safe.</h1>
<p class="hero-lead">From analysis to interactive reports, your agent gets database work done while dbcli verifies structure, protects sensitive data, and enforces clear boundaries.</p>
```

Use “See how it works” and “View on GitHub” as the two hero actions. Mirror the same churn-analysis conversation and the same four guardrails.

- [ ] **Step 3: Translate every remaining section with structural parity**

Keep the same section order and component counts:

1. `#workflow`: Describe the outcome, Confirm structure, Apply guardrails, Execute and verify, Deliver the result.
2. `#efficiency`: one-request workflows, reusable schema/queries, guided diagnosis and delivery.
3. `#safety`: credential isolation, sensitive-field blacklist, permissions/dry run, verification/recovery/audit.
4. `#platforms`: the exact same 13 platform chips.
5. `#quickstart`: Plugin/Skill first, CLI second, with the same verified commands.
6. `#faq`: natural English equivalents of the Chinese questions.

Do not leave Traditional Chinese interface text in the English page except the “繁體中文” language label.

- [ ] **Step 4: Extend the contract test with residual-language and asset checks**

Append:

```ts
test("English interface contains no residual Traditional Chinese copy", async () => {
  const { document } = await loadIntroPage("docs/dbcli-intro.en.html");
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".locale-link").forEach((node) => node.remove());
  expect(clone.textContent).not.toMatch(/[\u3400-\u9fff]/);
});

test.each(pages)("$locale local assets exist", async ({ path }) => {
  const { document } = await loadIntroPage(path);
  for (const element of document.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = element.getAttribute("src")!;
    if (/^(https?:|data:)/.test(src)) continue;
    const resolved = new URL(src, `file://${process.cwd()}/${path}`).pathname;
    expect(await Bun.file(resolved).exists()).toBe(true);
    expect(element.getAttribute("width")).toBeTruthy();
    expect(element.getAttribute("height")).toBeTruthy();
    expect(element.hasAttribute("alt")).toBe(true);
  }
});
```

- [ ] **Step 5: Run the full intro-page contract**

Run: `bun test tests/docs/intro-pages.test.ts`

Expected: all tests PASS with zero failures.

- [ ] **Step 6: Commit English parity**

```bash
git add docs/dbcli-intro.en.html tests/docs/intro-pages.test.ts
git commit -m "docs: mirror product redesign in English"
```

### Task 4: Validate presentation, documentation, and release safety

**Files:**
- Modify only if validation finds a defect: `docs/dbcli-intro.html`
- Modify only if validation finds a defect: `docs/dbcli-intro.en.html`
- Modify only if validation finds a contract gap: `tests/docs/intro-pages.test.ts`

**Interfaces:**
- Consumes: both completed static pages and the contract test.
- Produces: verified GitHub Pages-ready output with no structural, responsive, accessibility, or parity regressions.

- [ ] **Step 1: Run automated verification**

Run:

```bash
bun test tests/docs/intro-pages.test.ts
bun run docs:check
git diff --check
```

Expected: intro-page tests PASS, documentation parity check exits 0, and `git diff --check` prints no errors.

- [ ] **Step 2: Start a Bun static preview**

Run this exact Bun command in a retained terminal:

```bash
bun -e 'Bun.serve({ port: 4173, fetch(req) { const url = new URL(req.url); const pathname = url.pathname === "/" ? "/dbcli-intro.html" : url.pathname; const file = Bun.file(`docs${pathname}`); return file.exists().then((exists) => exists ? new Response(file) : new Response("Not found", { status: 404 })); } }); console.log("http://localhost:4173/dbcli-intro.html");'
```

Expected: the process remains running and prints `http://localhost:4173/dbcli-intro.html`.

- [ ] **Step 3: Inspect the Traditional Chinese page in the browser**

At 1440×900, 820×1180, and 390×844, verify:

- the first viewport shows the headline and conversation/guardrails visual without an install command;
- the visual order is conversation, result, then background protection;
- navigation anchors land below the sticky header;
- no horizontal scrolling or clipped text appears;
- focus indicators are visible when tabbing through navigation, CTAs, details, and copy buttons;
- copy feedback is announced and returns to its original label;
- FAQ opens and closes with keyboard input;
- reduced-motion mode presents all information without staged animation.

- [ ] **Step 4: Inspect English parity in the browser**

Open `http://localhost:4173/dbcli-intro.en.html` at 1440×900 and 390×844. Verify the same section order, component styling, workflow, safety layers, platform coverage, and quickstart routes. Confirm no Chinese copy remains outside the locale link.

- [ ] **Step 5: Fix any observed defect and rerun verification**

For each defect, first add or tighten an assertion in `tests/docs/intro-pages.test.ts` when the issue is structurally testable. Then patch the smallest relevant HTML/CSS/JavaScript block and rerun:

```bash
bun test tests/docs/intro-pages.test.ts
bun run docs:check
git diff --check
```

Expected: all commands exit 0 after the fix.

- [ ] **Step 6: Commit validation fixes if any**

```bash
git add docs/dbcli-intro.html docs/dbcli-intro.en.html tests/docs/intro-pages.test.ts
git commit -m "fix: polish intro page responsive behavior"
```

Skip this commit when validation required no file changes.

- [ ] **Step 7: Record final evidence**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: only intentional user-owned changes, if any, remain uncommitted; the log shows the contract, Chinese redesign, English parity, and optional validation-fix commits.

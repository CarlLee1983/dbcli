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

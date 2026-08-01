import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

const pages = [
  { locale: 'zh-TW', path: 'docs/dbcli-intro.html', counterpart: 'dbcli-intro.en.html' },
  { locale: 'en', path: 'docs/dbcli-intro.en.html', counterpart: 'dbcli-intro.html' },
] as const

async function loadIntroPage(path: string) {
  const html = await Bun.file(path).text()
  const window = new Window()
  window.document.write(html)
  return { html, document: window.document }
}

function cssText(document: Document) {
  return [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
}

function quickstartCommands(document: Document): string[] {
  return [...document.querySelectorAll('#quickstart .command-box code')]
    .flatMap((code) =>
      (code.textContent ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
    )
    .filter(Boolean)
}

function hexToRgb(hex: string) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hexToRgb(hex).map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter! + 0.05) / (darker! + 0.05)
}

function rootTokens(document: Document) {
  const root = cssText(document).match(/:root\s*\{([^}]+)\}/)?.[1] ?? ''
  return Object.fromEntries(
    [...root.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [
      match[1],
      match[2].toLowerCase(),
    ])
  )
}

describe.each(pages)('$locale intro page', ({ path, counterpart }) => {
  test('uses the approved semantic product-page structure', async () => {
    const { document } = await loadIntroPage(path)
    expect(document.querySelector('header.site-header')).not.toBeNull()
    expect(document.querySelector('main')).not.toBeNull()
    expect(document.querySelector('section#workflow')).not.toBeNull()
    expect(document.querySelector('section#efficiency')).not.toBeNull()
    expect(document.querySelector('section#safety')).not.toBeNull()
    expect(document.querySelector('section#platforms')).not.toBeNull()
    expect(document.querySelector('section#quickstart')).not.toBeNull()
    expect(document.querySelector('section#faq')).not.toBeNull()
    expect(document.querySelector('footer')).not.toBeNull()
  })

  test('leads with workflow value instead of installation', async () => {
    const { document } = await loadIntroPage(path)
    const hero = document.querySelector('.hero')
    expect(hero?.querySelector('.conversation-guardrails')).not.toBeNull()
    expect(hero?.querySelector('a[href="#workflow"]')).not.toBeNull()
    expect(hero?.querySelector('pre, .terminal, .install-command')).toBeNull()
  })

  test('has accessible navigation and motion fallback', async () => {
    const { html, document } = await loadIntroPage(path)
    expect(document.querySelector('a[href="#main-content"]')).not.toBeNull()
    expect(document.querySelector('nav[aria-label]')).not.toBeNull()
    expect(html).toContain(':focus-visible')
    expect(html).toContain('prefers-reduced-motion: reduce')
  })

  test('links to the counterpart locale with a relative URL', async () => {
    const { document } = await loadIntroPage(path)
    expect(document.querySelector(`a[href="./${counterpart}"]`)).not.toBeNull()
  })

  test('keeps text links comfortably tappable', async () => {
    const { html } = await loadIntroPage(path)
    expect(html).toMatch(/\.brand[^}]*min-height:\s*44px/)
    expect(html).toMatch(/\.nav-links a,\s*\.locale-link[^}]*min-height:\s*44px/)
    expect(html).toMatch(/\.nav-links a,\s*\.locale-link[^}]*min-width:\s*44px/)
    expect(html).toMatch(/\.support-links a[^}]*min-height:\s*44px/)
    expect(html).toMatch(/\.support-links a[^}]*min-width:\s*44px/)
    expect(html).toMatch(/\.footer-links a[^}]*min-height:\s*44px/)
    expect(html).toMatch(/\.footer-links a[^}]*min-width:\s*44px/)
  })

  test('labels the hero conversation as an example in visible copy', async () => {
    const { document } = await loadIntroPage(path)
    const panel = document.querySelector('.conversation-panel')
    expect(panel?.textContent).toMatch(/示意|example/i)
  })

  test('all internal fragment links have targets', async () => {
    const { document } = await loadIntroPage(path)
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      const target = link.getAttribute('href')!.slice(1)
      expect(target.length).toBeGreaterThan(0)
      expect(document.getElementById(target)).not.toBeNull()
    }
  })

  test('core normal-text color combinations meet WCAG AA', async () => {
    const { document } = await loadIntroPage(path)
    const tokens = rootTokens(document)
    const combinations = [
      ['orange-text', 'cream'],
      ['orange-text', 'paper'],
      ['orange-text', 'orange-soft'],
      ['paper', 'orange-action'],
      ['blue-text', 'blue-soft'],
    ] as const
    for (const [foreground, background] of combinations) {
      expect(contrastRatio(tokens[foreground]!, tokens[background]!)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

test('locale pages expose the same section and component contract', async () => {
  const zh = await loadIntroPage('docs/dbcli-intro.html')
  const en = await loadIntroPage('docs/dbcli-intro.en.html')
  const ids = (document: Document) =>
    [...document.querySelectorAll('main section[id]')].map((section) => section.id)
  expect(ids(zh.document)).toEqual(ids(en.document))
  expect(zh.document.querySelectorAll('.workflow-step').length).toBe(
    en.document.querySelectorAll('.workflow-step').length
  )
  expect(zh.document.querySelectorAll('.safety-layer').length).toBe(
    en.document.querySelectorAll('.safety-layer').length
  )
  expect(zh.document.querySelectorAll('.platform-chip').length).toBe(
    en.document.querySelectorAll('.platform-chip').length
  )
  expect(zh.document.querySelectorAll('.faq-list details').length).toBe(
    en.document.querySelectorAll('.faq-list details').length
  )
  expect(zh.document.querySelectorAll('.faq-list details').length).toBe(9)

  const approvedCommands = [
    '/plugin marketplace add CarlLee1983/dbcli',
    '/plugin install dbcli@carllee1983-dbcli',
    'dbcli skill --install codex',
    'bunx @carllee1983/dbcli init',
  ]
  expect(quickstartCommands(zh.document)).toEqual(approvedCommands)
  expect(quickstartCommands(en.document)).toEqual(approvedCommands)
  expect(cssText(zh.document)).toBe(cssText(en.document))
})

test('quickstart command extraction normalizes CRLF lines independently', () => {
  const window = new Window()
  window.document.write(
    '<section id="quickstart"><div class="command-box"><code>\r\n  first  \r\nsecond\r\n</code></div></section>'
  )

  expect(quickstartCommands(window.document)).toEqual(['first', 'second'])
})

test.each(pages)('$locale uses the real interactive-report command labels', async ({ path }) => {
  const { document } = await loadIntroPage(path)
  const labels = [...document.querySelectorAll('.command-label')].map((label) =>
    label.textContent?.trim()
  )
  expect(labels).not.toContain('report')
  expect(labels).not.toContain('recover · report')
  expect(labels).toContain('query --ui')
  expect(labels).toContain('recover · query --ui')
})

test('English interface contains no residual Traditional Chinese copy', async () => {
  const { document } = await loadIntroPage('docs/dbcli-intro.en.html')
  const clone = document.documentElement.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.locale-link').forEach((node) => node.remove())
  expect(clone.textContent).not.toMatch(/[\u3400-\u9fff]/)
})

test.each(pages)('$locale local assets exist', async ({ path }) => {
  const { document } = await loadIntroPage(path)
  for (const element of document.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = element.getAttribute('src')!
    if (/^(https?:|data:)/.test(src)) continue
    const resolved = new URL(src, `file://${process.cwd()}/${path}`).pathname
    expect(await Bun.file(resolved).exists()).toBe(true)
    expect(element.getAttribute('width')).toBeTruthy()
    expect(element.getAttribute('height')).toBeTruthy()
    expect(element.hasAttribute('alt')).toBe(true)
  }
})

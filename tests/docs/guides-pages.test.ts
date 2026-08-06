import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

const guideSlugs = [
  'safe-backfill',
  'agent-dashboard',
  'orm-schema-drift',
  'slow-endpoint',
] as const

const locales = [
  {
    locale: 'zh-TW',
    directory: 'docs/guides',
    home: '../dbcli-intro.html',
    docs: '../user/zh-TW/',
    counterpartPrefix: './en/',
  },
  {
    locale: 'en',
    directory: 'docs/guides/en',
    home: '../../dbcli-intro.en.html',
    docs: '../../user/en/',
    counterpartPrefix: '../',
  },
] as const

async function loadPage(path: string) {
  const html = await Bun.file(path).text()
  const window = new Window()
  window.document.write(html)
  return { html, document: window.document }
}

describe.each(locales)(
  '$locale guide collection',
  ({ directory, home, docs, counterpartPrefix }) => {
    test('has a hub that links to every published guide', async () => {
      const { document } = await loadPage(`${directory}/index.html`)
      expect(document.querySelector('main')).not.toBeNull()
      expect(document.querySelector('h1')).not.toBeNull()
      expect(document.querySelector('link[href$="dbcli-guides.css"]')).not.toBeNull()
      expect(document.querySelector(`a[href="${home}"]`)).not.toBeNull()
      expect(document.querySelector(`a[href="${docs}"]`)).not.toBeNull()

      for (const slug of guideSlugs) {
        expect(document.querySelector(`a[href="./${slug}.html"]`)).not.toBeNull()
      }
    })

    test.each(guideSlugs)('%s has a bilingual, reviewable workflow page', async (slug) => {
      const { document } = await loadPage(`${directory}/${slug}.html`)
      expect(document.querySelector('main')).not.toBeNull()
      expect(document.querySelector('header nav[aria-label]')).not.toBeNull()
      expect(document.querySelector('a[href="#main-content"]')).not.toBeNull()
      expect(document.querySelector('a[href="./index.html"]')).not.toBeNull()
      expect(document.querySelector(`a[href="${counterpartPrefix}${slug}.html"]`)).not.toBeNull()
      expect(document.querySelector('.boundary')).not.toBeNull()
      expect(document.querySelectorAll('.workflow .step').length).toBeGreaterThanOrEqual(3)
    })
  }
)

test('the product landing pages expose the use-case hubs', async () => {
  const zh = await loadPage('docs/dbcli-intro.html')
  const en = await loadPage('docs/dbcli-intro.en.html')
  expect(zh.document.querySelectorAll('a[href="./guides/"]').length).toBeGreaterThanOrEqual(2)
  expect(en.document.querySelectorAll('a[href="./guides/en/"]').length).toBeGreaterThanOrEqual(2)
})

test('safe-backfill pages clearly state that verification never runs the update', async () => {
  const zh = await loadPage('docs/guides/safe-backfill.html')
  const en = await loadPage('docs/guides/en/safe-backfill.html')
  expect(zh.document.querySelector('.boundary')?.textContent).toContain('永遠不會執行 UPDATE')
  expect(en.document.querySelector('.boundary')?.textContent).toContain('never executes an UPDATE')
})

test('ORM drift pages bootstrap the complete schema cache before comparison', async () => {
  for (const path of [
    'docs/guides/orm-schema-drift.html',
    'docs/guides/en/orm-schema-drift.html',
  ]) {
    const { document } = await loadPage(path)
    const commands = [...document.querySelectorAll('.workflow .command')].map((node) =>
      node.textContent?.trim()
    )
    expect(commands).toContain('dbcli blacklist list\ndbcli schema --format json')
    expect(commands.join('\n')).not.toContain('dbcli schema users --format json')
  }
})

test('all local guide links and documentation fragments resolve', async () => {
  const pages = locales.flatMap(({ directory }) => [
    `${directory}/index.html`,
    ...guideSlugs.map((slug) => `${directory}/${slug}.html`),
  ])

  for (const path of pages) {
    const { document } = await loadPage(path)
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = link.getAttribute('href')!
      const resolved = new URL(href, `file://${process.cwd()}/${path}`)
      if (resolved.protocol !== 'file:') continue

      const targetPath = decodeURIComponent(
        resolved.pathname.endsWith('/') ? `${resolved.pathname}index.html` : resolved.pathname
      )
      expect(await Bun.file(targetPath).exists()).toBe(true)
      if (resolved.hash) {
        const { document: target } = await loadPage(targetPath)
        expect(target.getElementById(resolved.hash.slice(1))).not.toBeNull()
      }
    }
  }
})

test('English guide pages contain no residual Traditional Chinese copy', async () => {
  for (const slug of ['index', ...guideSlugs]) {
    const { document } = await loadPage(`docs/guides/en/${slug}.html`)
    const clone = document.documentElement.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.locale-link').forEach((node) => node.remove())
    expect(clone.textContent).not.toMatch(/[\u3400-\u9fff]/)
  }
})

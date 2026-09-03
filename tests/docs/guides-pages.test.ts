import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const guideSlugs = [
  'safe-backfill',
  'agent-dashboard',
  'orm-schema-drift',
  'offline-impact-assessment',
  'evidence-packs',
  'semantic-contracts',
  'verification-evidence',
  'slow-endpoint',
  'why-dbcli',
  // Not `as const`, for the same reason as `locales` below.
]

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
  // Not `as const`: bun-types' object-table overload for `each` takes a mutable
  // array, and nothing here needs the literal types.
]

async function loadPage(path: string) {
  const html = (await Bun.file(path).text()).replace(/\r\n/g, '\n')
  const window = new Window()
  window.document.write(html)
  return { html, document: window.document }
}

/**
 * `guideSlugs` is a hand-kept list, and three guides once sat outside it for
 * several releases with no hub, structure, link or English-purity checking.
 * Reading the directory is what stops a fourth from doing the same.
 */
describe('guide coverage', () => {
  test.each(locales.map(({ locale, directory }) => [locale, directory]))(
    '%s: every published guide is listed in guideSlugs',
    async (_locale, directory) => {
      const published = (await readdir(directory))
        .filter((entry) => entry.endsWith('.html') && entry !== 'index.html')
        .map((entry) => entry.replace(/\.html$/, ''))
        .sort()

      expect(published).toEqual([...guideSlugs].sort())
    }
  )
})

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

test('why-dbcli uses its local illustration and a complete story arc in both languages', async () => {
  expect(await Bun.file('docs/assets/why-dbcli-hero.png').exists()).toBe(true)

  const heroPages: Array<[path: string, asset: string]> = [
    ['docs/guides/why-dbcli.html', '../assets/why-dbcli-hero.png'],
    ['docs/guides/en/why-dbcli.html', '../../assets/why-dbcli-hero.png'],
  ]
  for (const [path, asset] of heroPages) {
    const { document } = await loadPage(path)
    const image = document.querySelector('.story-hero-art img')
    expect(image?.getAttribute('src')).toBe(asset)
    expect(document.querySelectorAll('.story-timeline .story-moment').length).toBe(3)
    expect(document.querySelectorAll('.contrast-grid .contrast-panel').length).toBe(2)
  }
})

test('every guide inherits the elevated shared reading and interaction treatment', async () => {
  const styles = await Bun.file('docs/assets/dbcli-guides.css').text()
  expect(styles).toContain('.hero:not(.story-hero)')
  expect(styles).toContain('.guide-card:focus-within')
  expect(styles).toContain('.step:focus-within')
  expect(styles).toContain('.article .boundary h2')
  expect(styles).toContain('.next-card a')
  expect(styles).toContain('.article > p')
  expect(styles).toContain('max-inline-size: 66ch')
  expect(styles).toContain('text-wrap: pretty')
  expect(styles).toContain('@media (max-width: 720px)')
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

test('offline impact pages name the same optional evidence in both languages', async () => {
  const pages = [
    {
      path: 'docs/guides/offline-impact-assessment.html',
      events: 'workload',
      dataAccess: 'data-access metadata',
      boundary: '受保護識別字',
    },
    {
      path: 'docs/guides/en/offline-impact-assessment.html',
      events: 'workload evidence',
      dataAccess: 'data-access metadata',
      boundary: 'protected identifiers',
    },
  ]

  for (const { path, events, dataAccess, boundary } of pages) {
    const { document } = await loadPage(path)
    const article = document.querySelector('.workflow')!.textContent!
    const commands = [...document.querySelectorAll('.workflow .command')].map((node) =>
      node.textContent?.trim()
    )

    expect(commands.join('\n')).toContain('--events ./.dbcli/proxy/events.jsonl')
    expect(article).toContain(events)
    expect(article).toContain(dataAccess)
    expect(document.querySelector('.boundary')?.textContent).toContain(boundary)
  }
})

test('evidence-pack pages refuse to turn a claim into a verdict, in both languages', async () => {
  const pages = [
    {
      path: 'docs/guides/evidence-packs.html',
      claim: '這是送審主張，不是 dbcli 自己下的結論',
      boundary: '不會把 claims 變成證明',
    },
    {
      path: 'docs/guides/en/evidence-packs.html',
      claim: 'a review claim, not a verdict created by dbcli',
      boundary: 'it does not make a claim true',
    },
  ]

  for (const { path, claim, boundary } of pages) {
    const { document } = await loadPage(path)
    expect(document.querySelector('.workflow')?.textContent).toContain(claim)
    expect(document.querySelector('.boundary')?.textContent).toContain(boundary)
  }
})

test('all local guide links and documentation fragments resolve', async () => {
  const pages = locales.flatMap(({ directory }) => [
    `${directory}/index.html`,
    ...guideSlugs.map((slug) => `${directory}/${slug}.html`),
  ])

  for (const path of pages) {
    const { document } = await loadPage(path)
    for (const link of document.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href')!
      const resolved = new URL(href, pathToFileURL(resolve(path)))
      if (resolved.protocol !== 'file:') continue

      const target = resolved.pathname.endsWith('/') ? new URL('index.html', resolved) : resolved
      const targetPath = fileURLToPath(target)
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
    const clone = document.documentElement.cloneNode(true)
    clone.querySelectorAll('.locale-link').forEach((node) => node.remove())
    expect(clone.textContent).not.toMatch(/[\u3400-\u9fff]/)
  }
})

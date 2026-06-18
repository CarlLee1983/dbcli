const locales = ['en', 'zh-TW'] as const

const requiredDocKeys = [
  'overview',
  'core-philosophy',
  'getting-started',
  'connection-management',
  'command-reference',
  'discovery-exploration',
  'query-data-operations',
  'snippet-management',
  'diagnostics-recovery',
  'advanced-tools',
  'html-dashboards',
  'engine-support',
  'ai-agent-integration',
  'documentation-maintenance',
] as const

function extractDocKeys(source: string): string[] {
  return [...source.matchAll(/<!--\s*doc-key:\s*([a-z0-9-]+)\s*-->/g)].map((match) => {
    const key = match[1]
    if (!key) throw new Error(`Malformed doc-key marker: ${match[0]}`)
    return key
  })
}

async function readDoc(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new Error(`Missing documentation file: ${path}`)
  }
  return file.text()
}

function assertNoDuplicates(path: string, keys: string[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }

  if (duplicates.size > 0) {
    throw new Error(`${path} has duplicate doc-key markers: ${[...duplicates].join(', ')}`)
  }
}

function assertRequiredKeys(path: string, keys: string[]): void {
  const keySet = new Set(keys)
  const missing = requiredDocKeys.filter((key) => !keySet.has(key))

  if (missing.length > 0) {
    throw new Error(`${path} is missing required doc-key markers: ${missing.join(', ')}`)
  }
}

function assertSameOrder(locale: string, mdKeys: string[], htmlKeys: string[]): void {
  const md = mdKeys.join('\n')
  const html = htmlKeys.join('\n')

  if (md === html) return

  const max = Math.max(mdKeys.length, htmlKeys.length)
  for (let index = 0; index < max; index += 1) {
    if (mdKeys[index] !== htmlKeys[index]) {
      throw new Error(
        [
          `docs/user/${locale} Markdown/HTML doc-key order diverges at position ${index + 1}.`,
          `Markdown: ${mdKeys[index] ?? '<missing>'}`,
          `HTML: ${htmlKeys[index] ?? '<missing>'}`,
        ].join('\n')
      )
    }
  }
}

for (const locale of locales) {
  const mdPath = `docs/user/${locale}/index.md`
  const htmlPath = `docs/user/${locale}/index.html`

  const [md, html] = await Promise.all([readDoc(mdPath), readDoc(htmlPath)])
  const mdKeys = extractDocKeys(md)
  const htmlKeys = extractDocKeys(html)

  assertNoDuplicates(mdPath, mdKeys)
  assertNoDuplicates(htmlPath, htmlKeys)
  assertRequiredKeys(mdPath, mdKeys)
  assertRequiredKeys(htmlPath, htmlKeys)
  assertSameOrder(locale, mdKeys, htmlKeys)

  console.log(`✓ docs/user/${locale}: ${mdKeys.length} Markdown/HTML topics aligned`)
}

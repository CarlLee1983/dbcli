import { describe, expect, test } from 'bun:test'

const read = async (path: string) => Bun.file(path).text()

const RULES = [
  'select-star',
  'unanchored-like',
  'missing-limit-offset',
  'non-sargable-where',
  'or-to-union',
  'subquery-to-join',
  'distinct-groupby-abuse',
  'implicit-cast',
  'not-in-nullable',
]

describe('lint documentation', () => {
  test('canonical skill assets route slow-query work through lint', async () => {
    const [english, chinese] = await Promise.all([
      read('assets/SKILL.md'),
      read('assets/SKILL.zh-TW.md'),
    ])

    for (const skill of [english, chinese]) {
      expect(skill).toContain('| `lint` | n/a |')
      expect(skill).toContain('dbcli lint "<SQL>" --format json')
      expect(skill).toContain('→ `lint "<SQL>"` → `guide missing-index-for "<SQL>"`')
      expect(skill).toContain('→ `lint "<query>"` → `guide missing-index-for "<query>"`')
    }
  })

  test('reference documents the complete offline lint contract', async () => {
    const reference = await read('assets/reference.md')

    expect(reference).toContain('dbcli --use <conn> lint')
    expect(reference).toContain('.dbcli/schemas/<conn>/')
    expect(reference).toContain('never opens a database connection')
    expect(reference).toContain('blocked: parse failed')
    expect(reference).toContain('blocked: --no-schema')
    expect(reference).toContain('blocked: schema cache unavailable')
    expect(reference).toContain("@queries/**/*.sql")
    for (const rule of RULES) expect(reference).toContain(`\`${rule}\``)
  })

  test('English and Traditional Chinese user docs cover lint in Markdown and HTML', async () => {
    const docs = await Promise.all([
      read('docs/user/en/index.md'),
      read('docs/user/en/index.html'),
      read('docs/user/zh-TW/index.md'),
      read('docs/user/zh-TW/index.html'),
    ])

    for (const doc of docs) {
      expect(doc).toContain('dbcli --use staging lint')
      expect(doc).toContain('.dbcli/schemas/')
      expect(doc).toContain('not-in-nullable')
      expect(doc).toContain('IS NOT NULL')
      expect(doc).toContain('NOT EXISTS')
      for (const rule of RULES) expect(doc).toContain(rule)
    }
  })
})

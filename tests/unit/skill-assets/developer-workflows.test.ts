import { describe, expect, test } from 'bun:test'

const read = async (path: string) => (await Bun.file(path).text()).replace(/\r\n/g, '\n')

describe('developer workflow skill guidance', () => {
  test('English canonical skill includes compact developer workflow triggers', async () => {
    const skill = await read('assets/SKILL.md')

    expect(skill).toContain('## Developer workflows')
    expect(skill).toContain(
      'Use these workflows when database impact is implicit in a development task.'
    )
    expect(skill).toContain('DB-backed feature')
    expect(skill).toContain('Application data bug')
    expect(skill).toContain('ORM or migration work')
    expect(skill).toContain('PR database review')
    expect(skill).toContain('Slow endpoint or query')
    expect(skill).toContain('Safe data backfill')
    expect(skill).toContain('Environment validation')
  })

  test('English canonical skill preserves required safety commands', async () => {
    const skill = await read('assets/SKILL.md')

    expect(skill).toContain('dbcli inspect --for-agent --format json')
    expect(skill).toContain('dbcli blacklist list --format json')
    expect(skill).toContain('dbcli schema <object> --format json')
    expect(skill).toContain('dbcli queries suggest <intent> --format json')
    expect(skill).toContain('dbcli audit tail --for-agent --n 10')
    expect(skill).toContain('dbcli diff --snapshot <name>')
    expect(skill).toContain('dbcli report --section perf --format json')
    expect(skill).toContain('dbcli guide missing-index-for "<query>" --format json')
    expect(skill).toContain(
      'dbcli update <object> --where "<bounded predicate>" --set \'<json>\' --dry-run --format json'
    )
    expect(skill).toContain('dbcli inspect --for-agent --no-connect --format json')
  })

  test('English canonical skill states developer workflow acceptance rules', async () => {
    const skill = await read('assets/SKILL.md')

    expect(skill).toContain('Never invent table, collection, key, index, or field names.')
    expect(skill).toContain('Separate database facts from application-code inference.')
    expect(skill).toContain(
      'Do not create indexes directly from a performance suggestion; turn them into reviewed migrations.'
    )
    expect(skill).toContain(
      'Do not print credentials, copied connection strings, or blacklisted values.'
    )
  })

  test('English canonical skill proactively routes business-language requests through semantic context', async () => {
    const skill = await read('assets/SKILL.md')

    expect(skill).toContain('**Business-language discovery:**')
    expect(skill).toContain('dbcli skill context --context-version 2 --format json')
    expect(skill).toContain('dbcli semantic search <terms> --format json')
    expect(skill).toContain('If no semantic section exists or search returns no result')
    expect(skill).toContain(
      'Never create, update, or\nmigrate that file without an explicit human request'
    )
    expect(skill).toContain('schema confirmation or the normal query/write safety gates')
  })

  test('canonical skill defines per-request intent confirmation without weakening safety gates', async () => {
    const english = await read('assets/SKILL.md')

    expect(english).toContain('**Intent confirmation:**')
    expect(english).toContain('`auto`, `confirm`, and `guided`')
    expect(english).toContain('not as dbcli flags or persistent configuration')
    expect(english).toContain('Do not ask the user a meta-question')
    expect(english).toContain('one compact batch of\n  questions')
    expect(english).toContain('This never bypasses blacklist, schema,')
  })

  test('user documentation explains intent confirmation in every language and format', async () => {
    const [englishMarkdown, englishHtml, chineseMarkdown, chineseHtml] = await Promise.all([
      read('docs/user/en/index.md'),
      read('docs/user/en/index.html'),
      read('docs/user/zh-TW/index.md'),
      read('docs/user/zh-TW/index.html'),
    ])

    for (const doc of [englishMarkdown, englishHtml]) {
      expect(doc).toContain('Intent confirmation for business requests')
      expect(doc).toContain('auto')
      expect(doc).toContain('confirm')
      expect(doc).toContain('guided')
      expect(doc).toContain('dry-run')
    }

    for (const doc of [chineseMarkdown, chineseHtml]) {
      expect(doc).toContain('業務請求的意圖確認')
      expect(doc).toContain('auto')
      expect(doc).toContain('confirm')
      expect(doc).toContain('guided')
      expect(doc).toContain('dry-run')
    }
  })
})

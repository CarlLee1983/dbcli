import { describe, expect, test } from 'bun:test'

const read = async (path: string) => Bun.file(path).text()

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
    expect(skill).toContain('dbcli skill context --format json')
    expect(skill).toContain('dbcli semantic search <terms> --format json')
    expect(skill).toContain('If no semantic section exists or search returns no result')
    expect(skill).toContain(
      'Never create, update, or\nmigrate that file without an explicit human request'
    )
    expect(skill).toContain('schema confirmation or the normal query/write safety gates')
  })

  test('Traditional Chinese canonical skill mirrors developer workflow guidance', async () => {
    const skill = await read('assets/SKILL.zh-TW.md')

    expect(skill).toContain('## 開發者工作流')
    expect(skill).toContain('當資料庫影響隱含在開發任務中時使用這些流程')
    expect(skill).toContain('DB-backed 功能')
    expect(skill).toContain('應用程式資料錯誤')
    expect(skill).toContain('ORM 或 migration')
    expect(skill).toContain('PR 資料庫風險審查')
    expect(skill).toContain('慢 endpoint 或查詢')
    expect(skill).toContain('安全資料回填')
    expect(skill).toContain('環境設定驗證')
    expect(skill).toContain('不要列印 credentials、複製的連線字串或 blacklisted 值')
    expect(skill).toContain('**業務語言探索：**')
    expect(skill).toContain('dbcli skill context --format json')
    expect(skill).toContain('dbcli semantic search <terms> --format json')
    expect(skill).toContain('若沒有 semantic 區塊，或搜尋沒有結果')
    expect(skill).toContain('除非人類明確要求，絕不可建立、更新或 migrate 此檔案')
  })
})

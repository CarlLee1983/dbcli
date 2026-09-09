/**
 * 決策記錄的連結會爛，而爛掉的當下沒有任何跡象——要等到有人去點它。
 *
 * DBCLI-021 把 28 份記錄全部改名（`0028-*.md` → `ADR-0028-*.md`），為的是讓上游的
 * 契約檢查解析得到 `Decision:` 那一行。改名同時動到 21 個檔案裡的路徑引用，漏掉一個
 * 就是一條死連結。這支測試就是那個「漏掉一個會紅」的東西。
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { $ } from 'bun'

const repoRoot = path.resolve(import.meta.dir, '../../..')
const adrDir = path.join(repoRoot, 'docs/adr')

/** 版控裡的檔案，不掃 node_modules 也不掃未追蹤的暫存檔。 */
async function trackedTextFiles(): Promise<string[]> {
  const listed = await $`git -C ${repoRoot} ls-files -- '*.md' '*.ts' '*.yml' '*.json'`.text()
  return listed.split('\n').filter((line) => line.length > 0)
}

describe('ADR references', () => {
  it('every record carries the ADR-<digits> prefix the contract resolves', () => {
    const files = readdirSync(adrDir).filter((name) => name.endsWith('.md'))

    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      // README.md 之類的索引檔不是記錄；目前沒有，有的話這裡要放行而不是改文法。
      expect(name).toMatch(/^ADR-\d{4}-[a-z0-9-]+\.md$/)
    }
  })

  it('every relative link between records resolves', () => {
    // 記錄之間互相引用時寫的是相對路徑，沒有 `docs/adr/` 前綴，所以下面那一則掃不到。
    // 改名時這四條就是差點被漏掉的——ADR-0011 指向 ADR-0012 的那種。
    const linkPattern = /\]\((?!https?:|#)([A-Za-z0-9._-]+\.md)\)/g
    const missing: string[] = []
    let seen = 0

    for (const name of readdirSync(adrDir).filter((file) => file.endsWith('.md'))) {
      const source = readFileSync(path.join(adrDir, name), 'utf8')
      for (const match of source.matchAll(linkPattern)) {
        seen += 1
        if (!existsSync(path.join(adrDir, match[1] ?? ''))) missing.push(`${name} -> ${match[1]}`)
      }
    }

    expect(seen).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('every record declares Status the adopted contract can read', () => {
    // 上游把狀態讀成標題外的 `* Status:` bullet，不是 YAML frontmatter。兩種寫法並存
    // 會讓同一份記錄有兩個狀態，所以這裡要求只有一種，而且是被檢查的那一種。
    for (const name of readdirSync(adrDir).filter((file) => file.endsWith('.md'))) {
      const source = readFileSync(path.join(adrDir, name), 'utf8')
      const declarations = source.split('\n').filter((line) => line.startsWith('* Status: '))

      expect(`${name}: ${declarations.length}`).toBe(`${name}: 1`)
      expect(source.startsWith('---\n')).toBe(false)
    }
  })

  it('every docs/adr path written anywhere in the repository resolves', async () => {
    const referencePattern = /docs\/adr\/[A-Za-z0-9._-]+\.md/g
    const missing: string[] = []
    let seen = 0

    for (const file of await trackedTextFiles()) {
      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      for (const match of source.matchAll(referencePattern)) {
        seen += 1
        const target = path.join(repoRoot, match[0])
        if (!existsSync(target)) missing.push(`${file} -> ${match[0]}`)
      }
    }

    // 一個都沒掃到的話這則測試就什麼都沒保證——那是「零個樣本也算通過」的形狀。
    expect(seen).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })
})

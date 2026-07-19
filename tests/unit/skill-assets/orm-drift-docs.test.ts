import { describe, expect, test } from 'bun:test'

const read = async (path: string): Promise<string> => Bun.file(path).text()

const commandStrings = [
  'dbcli diff --against-orm prisma/schema.prisma --format json',
  'dbcli diff --against-orm "migrations/*.sql" --format markdown',
  'dbcli skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma --format json',
] as const

describe('ORM drift documentation contract', () => {
  test('canonical English and Traditional Chinese skills expose the same commands and workflow', async () => {
    const [english, traditionalChinese] = await Promise.all([
      read('assets/SKILL.md'),
      read('assets/SKILL.zh-TW.md'),
    ])

    for (const command of commandStrings) {
      expect(english).toContain(command)
      expect(traditionalChinese).toContain(command)
    }

    for (const skill of [english, traditionalChinese]) {
      expect(skill).toContain('`orm-drift-review`')
      expect(skill).toContain('`--against-orm <path>`')
      expect(skill).toContain('`--orm-format prisma\\|ddl\\|json`')
      expect(skill).toContain('`--ignore <globs>`')
      expect(skill).toContain('`--format json\\|table\\|markdown`')
      expect(skill).toContain('`migration-review`')
    }
  })

  test('exhaustive reference pins input, identity, comparison, proposal, and failure semantics', async () => {
    const reference = await read('assets/reference.md')

    for (const text of [
      '--against-orm <paths>',
      'repeatable or comma-separated',
      'DDL inputs support real filesystem globs',
      'Prisma and normalized JSON accept exactly one file',
      'does not open a database connection',
      'exit code `1`',
      '`missing_in_db`',
      '`missing_in_orm`',
      '`mismatch`',
      '`unmanaged`',
      '`unparsed`',
      'same-family type spelling',
      'exact, case-sensitive',
      'unquoted SQL identifiers fold to lowercase',
      'quoted identifiers match exactly',
      'parsed identifier representation',
      '`users` and `"Users"`',
      'duplicate resolved table identities',
      'structural index signatures',
      'stable',
      'shell-safe',
      'schema-qualified',
      'not losslessly representable',
      '--recovery',
      '`orm-drift-review`',
      '--param "table=${exact_table}"',
      '--param "ddl=${captured_ddl}"',
    ]) {
      expect(reference).toContain(text)
    }
  })

  test('user Markdown and polished HTML docs mirror the ORM drift workflow in both languages', async () => {
    const paths = [
      'docs/user/en/index.md',
      'docs/user/zh-TW/index.md',
      'docs/user/en/index.html',
      'docs/user/zh-TW/index.html',
    ]

    for (const path of paths) {
      const document = await read(path)
      expect(document).toContain('orm-drift-review')
      expect(document).toContain('diff --against-orm')
      expect(document).toContain('migration-review')
      expect(document).toContain('missing_in_db')
      expect(document).toContain('missing_in_orm')
      expect(document).toContain('users')
      expect(document).toContain('Users')
      expect(document).toContain('--recovery')
    }
  })
})

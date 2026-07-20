import { describe, expect, test } from 'bun:test'

const read = async (path: string): Promise<string> => Bun.file(path).text()

const commandStrings = [
  'dbcli diff --against-orm prisma/schema.prisma --format json',
  'dbcli diff --against-orm "migrations/*.sql" --format markdown',
  'dbcli skill tasks plan orm-drift-review --param orm_path=prisma/schema.prisma --format json',
] as const

function sectionBetween(document: string, start: string, end: string): string {
  const startIndex = document.indexOf(start)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  const endIndex = document.indexOf(end, startIndex + start.length)
  expect(endIndex).toBeGreaterThan(startIndex)
  return document.slice(startIndex, endIndex)
}

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
      expect(skill).toContain(
        '`--orm-format prisma\\|ddl\\|json\\|drizzle\\|typeorm\\|sequelize`'
      )
      expect(skill).toContain('`--ignore <globs>`')
      expect(skill).toContain('`--format json\\|table\\|markdown`')
      expect(skill).toContain('`migration-review`')
      expect(skill).toContain('drizzle/meta/<NNNN>_snapshot.json')
      expect(skill).toContain('drizzle-kit generate')
      expect(skill).toContain('`.ts`')
      expect(skill).toContain('TypeORM/Sequelize')
      expect(skill).toContain('schema:log')
      expect(skill).toContain('schema-only')
    }
  })

  test('exhaustive reference pins input, identity, comparison, proposal, and failure semantics', async () => {
    const reference = await read('assets/reference.md')

    for (const text of [
      '--against-orm <paths>',
      'repeatable or comma-separated',
      'DDL-family inputs (raw DDL, TypeORM, and Sequelize) support real filesystem globs',
      'Prisma, normalized JSON, and Drizzle accept exactly one file',
      'PostgreSQL drizzle-kit v7 snapshot',
      'drizzle/meta/<NNNN>_snapshot.json',
      'drizzle-kit generate',
      '(`.ts` or `.TS`)',
      '--orm-format prisma\\|ddl\\|json\\|drizzle\\|typeorm\\|sequelize',
      'bunx typeorm schema:log -d <path/to/datasource> > schema.sql',
      'dbcli diff --against-orm schema.sql --orm-format typeorm --format table',
      'bunx sequelize-cli db:migrate',
      'pg_dump --schema-only <scratch-database> > schema.sql',
      'mysqldump --no-data <database> > schema.sql',
      'dbcli diff --against-orm schema.sql --orm-format sequelize --format json',
      '`typeorm_metadata` and `migrations`',
      '`SequelizeMeta`',
      'does not provide a universal `db:migrate --dry-run`',
      'Drizzle enums',
      'blocked',
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
    const documents = [
      {
        path: 'docs/user/en/index.md',
        start: '#### ORM definition drift',
        snapshotPath: 'drizzle/meta/<NNNN>_snapshot.json',
        typeormCommand: 'bunx typeorm schema:log -d <path/to/datasource> > schema.sql',
        pgDumpCommand: 'pg_dump --schema-only <scratch-database> > schema.sql',
        mysqlDumpCommand: 'mysqldump --no-data <database> > schema.sql',
      },
      {
        path: 'docs/user/zh-TW/index.md',
        start: '#### ORM 定義漂移',
        snapshotPath: 'drizzle/meta/<NNNN>_snapshot.json',
        typeormCommand: 'bunx typeorm schema:log -d <path/to/datasource> > schema.sql',
        pgDumpCommand: 'pg_dump --schema-only <scratch-database> > schema.sql',
        mysqlDumpCommand: 'mysqldump --no-data <database> > schema.sql',
      },
      {
        path: 'docs/user/en/index.html',
        start: '<h4 class="mt-0 mb-3 font-bold text-text-main">ORM definition drift</h4>',
        snapshotPath: 'drizzle/meta/&lt;NNNN&gt;_snapshot.json',
        typeormCommand: 'bunx typeorm schema:log -d &lt;path/to/datasource&gt; &gt; schema.sql',
        pgDumpCommand: 'pg_dump --schema-only &lt;scratch-database&gt; &gt; schema.sql',
        mysqlDumpCommand: 'mysqldump --no-data &lt;database&gt; &gt; schema.sql',
      },
      {
        path: 'docs/user/zh-TW/index.html',
        start: '<h4 class="mt-0 mb-3 font-bold text-text-main">ORM 定義漂移</h4>',
        snapshotPath: 'drizzle/meta/&lt;NNNN&gt;_snapshot.json',
        typeormCommand: 'bunx typeorm schema:log -d &lt;path/to/datasource&gt; &gt; schema.sql',
        pgDumpCommand: 'pg_dump --schema-only &lt;scratch-database&gt; &gt; schema.sql',
        mysqlDumpCommand: 'mysqldump --no-data &lt;database&gt; &gt; schema.sql',
      },
    ] as const

    for (const {
      path,
      start,
      snapshotPath,
      typeormCommand,
      pgDumpCommand,
      mysqlDumpCommand,
    } of documents) {
      const section = sectionBetween(await read(path), start, '<!-- doc-key: data-verification -->')
      for (const text of [
        'orm-drift-review',
        'diff --against-orm',
        'migration-review',
        'missing_in_db',
        'missing_in_orm',
        'users',
        'Users',
        '--recovery',
        'Drizzle',
        'PostgreSQL drizzle-kit v7 snapshot',
        snapshotPath,
        'drizzle-kit generate',
        '--orm-format prisma|ddl|json|drizzle|typeorm|sequelize',
        typeormCommand,
        pgDumpCommand,
        mysqlDumpCommand,
        'bunx sequelize-cli db:migrate',
        'dbcli diff --against-orm schema.sql --orm-format typeorm --format table',
        'dbcli diff --against-orm schema.sql --orm-format sequelize --format json',
        'typeorm_metadata',
        'migrations',
        'SequelizeMeta',
        '.mjs',
        '.cjs',
        'enum',
        'unparsed',
        'blocked:',
      ]) {
        expect(section).toContain(text)
      }
    }
  })
})

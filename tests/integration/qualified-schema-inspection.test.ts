/** Real CLI coverage for ADR-0048. Only docker-compose.test.yml services are used. */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TableSchema } from '@/adapters/types'

const ROOT = resolve(import.meta.dir, '../..')
const CLI = join(ROOT, 'src/cli.ts')
const SUFFIX = `${process.pid}_${Date.now()}`
const OTHER = `g1_${SUFFIX}`
const TABLE = `g1_object_${SUFFIX}`
const PARENT = `g1_parent_${SUFFIX}`
const VIEW = `g1_view_${SUFFIX}`
const MATERIALIZED = `g1_mat_${SUFFIX}`
const EXPRESSION_TABLE = `g1_expression_${SUFFIX}`
const COMMA_PARENT = `g1_comma_parent_${SUFFIX}`
const COMMA_SOURCE = `g1_comma_source_${SUFFIX}`
const RESTRICTED = `g1_reader_${SUFFIX}`
const SPECIAL = `Order.Items"${SUFFIX}`
const MYSQL_SPECIAL = `Order.Items\`${SUFFIX}`
const workspaces: string[] = []
type Engine = 'postgresql' | 'mysql' | 'mariadb'
interface Blacklist {
  tables: string[]
  columns: Record<string, string[]>
}
interface Result {
  stdout: string
  stderr: string
  code: number
}
interface Project {
  dir: string
  env: Record<string, string>
}
type SchemaJson = TableSchema & {
  estimatedRowCount: number | null
  sizeCategory: string | null
  metadata: { rowCount?: number }
}

const engines: Engine[] = ['postgresql', 'mysql', 'mariadb']
const namespace = (engine: Engine) => (engine === 'postgresql' ? 'public' : 'dbcli_test')
const quote = (engine: Engine, value: string) =>
  engine === 'postgresql'
    ? `"${value.replaceAll('"', '""')}"`
    : `\`${value.replaceAll('`', '``')}\``
const qualified = (engine: Engine, schema: string, name: string) =>
  `${quote(engine, schema)}.${quote(engine, name)}`

async function collect(child: {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}): Promise<Result> {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

async function fixtureSql(engine: Engine, sql: string): Promise<void> {
  const service = engine === 'postgresql' ? 'postgres' : engine
  const client =
    engine === 'postgresql'
      ? ['psql', '-U', 'dbcli', '-d', 'dbcli_test', '-v', 'ON_ERROR_STOP=1']
      : [engine === 'mariadb' ? 'mariadb' : 'mysql', '-uroot', '-ptestpass']
  const result = await collect(
    Bun.spawn(
      [
        'docker',
        'compose',
        '-f',
        join(ROOT, 'docker-compose.test.yml'),
        'exec',
        '-T',
        service,
        ...client,
      ],
      { cwd: ROOT, stdin: new TextEncoder().encode(sql), stdout: 'pipe', stderr: 'pipe' }
    )
  )
  if (result.code !== 0) throw new Error(`Disposable ${service} fixture failed: ${result.stderr}`)
}

async function project(
  engine: Engine,
  blacklist: Blacklist = { tables: ['g1_never_match'], columns: {} },
  restricted = false
): Promise<Project> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-qualified-schema-')))
  workspaces.push(dir)
  await mkdir(join(dir, 'home'))
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(dir, 'home'),
    XDG_CONFIG_HOME: join(dir, 'home', '.config'),
    BUN_INSTALL_CACHE_DIR: join(dir, 'harness', 'bun-cache'),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, 'harness', 'transpiler'),
    DBCLI_CONFIG_HOME: join(dir, 'registry'),
    DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR: join(dir, 'anchors'),
    DBCLI_LANG: 'en',
    DBCLI_AGENT_MODE: '1',
    DBCLI_NO_UPDATE_CHECK: '1',
    NODE_ENV: 'test',
    NO_COLOR: '1',
  }
  // A separate process binds integrity to this isolated HOME without mutating
  // the test runner's environment or touching its ambient credential registry.
  const config = {
    connection: {
      system: engine,
      host: '127.0.0.1',
      port: { postgresql: 5433, mysql: 3307, mariadb: 3308 }[engine],
      user: restricted ? RESTRICTED : 'dbcli',
      password: 'testpass',
      database: 'dbcli_test',
    },
    permission: 'query-only',
    schema: {},
    metadata: { createdAt: '2026-01-01T00:00:00.000Z', version: '1.0' },
    blacklist,
    audit: { enabled: false },
  }
  const writer = `import { writeConfigWithIntegrity } from ${JSON.stringify(join(ROOT, 'src/core/config-integrity.ts'))}; await writeConfigWithIntegrity(process.argv[1], await Bun.stdin.text())`
  const setup = await collect(
    Bun.spawn([process.execPath, '--no-env-file', '-e', writer, join(dir, '.dbcli')], {
      cwd: dir,
      env: { ...env, DBCLI_AGENT_MODE: '0' },
      stdin: new TextEncoder().encode(JSON.stringify(config)),
      stdout: 'pipe',
      stderr: 'pipe',
    })
  )
  if (setup.code !== 0) throw new Error(`Isolated config setup failed: ${setup.stderr}`)
  return { dir, env }
}

async function run(project: Project, args: string[]): Promise<Result> {
  return collect(
    Bun.spawn([process.execPath, '--no-env-file', 'run', CLI, ...args], {
      cwd: project.dir,
      env: project.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  )
}

async function inspect(project: Project, name: string): Promise<SchemaJson> {
  const result = await run(project, ['schema', name, '--format', 'json'])
  expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: '' })
  return JSON.parse(result.stdout) as SchemaJson
}

async function snapshot(project: Project): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(project.dir, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files[path] = await Bun.file(join(project.dir, path)).text()
    }
  }
  for (const path of ['.dbcli', 'anchors', 'registry']) {
    try {
      await visit(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return files
}

beforeAll(async () => {
  for (const engine of engines) {
    const q = (s: string) => quote(engine, s)
    const id = (schema: string, name: string) => qualified(engine, schema, name)
    const base = namespace(engine)
    if (engine === 'postgresql') {
      await fixtureSql(
        engine,
        `CREATE SCHEMA ${q(OTHER)};
        CREATE ROLE ${q(RESTRICTED)} LOGIN PASSWORD 'testpass';
        GRANT USAGE ON SCHEMA ${q(OTHER)} TO ${q(RESTRICTED)};`
      )
    } else {
      await fixtureSql(
        engine,
        `CREATE DATABASE ${q(OTHER)};
        GRANT ALL ON ${q(OTHER)}.* TO 'dbcli'@'%';
        CREATE USER '${RESTRICTED}'@'%' IDENTIFIED BY 'testpass';`
      )
    }
    for (const [schema, marker, values] of [
      [base, 'default_marker', ['draft', 'live']],
      [OTHER, 'other_marker', ['queued', 'sent']],
    ] as const) {
      const stateType =
        engine === 'postgresql' ? id(schema, `g1_state_${SUFFIX}`) : `ENUM('${values.join("','")}')`
      const enumSetup =
        engine === 'postgresql' ? `CREATE TYPE ${stateType} AS ENUM ('${values.join("','")}');` : ''
      await fixtureSql(
        engine,
        `${enumSetup}
        CREATE TABLE ${id(schema, PARENT)} (parent_id integer, parent_secret integer, PRIMARY KEY (parent_id, parent_secret));
        CREATE TABLE ${id(schema, TABLE)} (id integer, secret_key integer, ${marker} text, state ${stateType},
          CONSTRAINT ${q(`g1_same_pk_${SUFFIX}`)} PRIMARY KEY (id, secret_key));
        CREATE INDEX ${q(`g1_same_index_${SUFFIX}`)} ON ${id(schema, TABLE)} (id, secret_key);
        CREATE VIEW ${id(schema, VIEW)} AS SELECT id, ${marker} FROM ${id(schema, TABLE)};`
      )
      // Add FKs after both parent namespaces exist, below.
    }
    for (const schema of [base, OTHER]) {
      const target = schema === base ? OTHER : base
      await fixtureSql(
        engine,
        `ALTER TABLE ${id(schema, TABLE)} ADD CONSTRAINT ${q(`g1_same_fk_${SUFFIX}`)}
        FOREIGN KEY (id, secret_key) REFERENCES ${id(target, PARENT)} (parent_id, parent_secret);`
      )
    }
    await fixtureSql(
      engine,
      engine === 'postgresql'
        ? `GRANT SELECT ON ${id(base, VIEW)} TO ${q(RESTRICTED)};`
        : `GRANT SELECT ON ${id(base, VIEW)} TO '${RESTRICTED}'@'%';`
    )
    const special = engine === 'postgresql' ? SPECIAL : MYSQL_SPECIAL
    await fixtureSql(engine, `CREATE TABLE ${id(OTHER, special)} (special_marker integer);`)
    if (engine === 'postgresql') {
      await fixtureSql(
        engine,
        `CREATE MATERIALIZED VIEW ${id(OTHER, MATERIALIZED)} AS SELECT id, state FROM ${id(OTHER, TABLE)};
        CREATE TABLE ${id(base, `audit.orders_${SUFFIX}`)} (literal_marker integer);
        CREATE TABLE ${id(OTHER, EXPRESSION_TABLE)} (id integer, secret text);
        CREATE INDEX ${q(`g1_expression_secret_${SUFFIX}`)} ON ${id(OTHER, EXPRESSION_TABLE)} (id, lower(secret));
        CREATE INDEX ${q(`g1_partial_secret_${SUFFIX}`)} ON ${id(OTHER, EXPRESSION_TABLE)} (id) WHERE secret = 'classified';
        CREATE INDEX ${q(`g1_safe_${SUFFIX}`)} ON ${id(OTHER, EXPRESSION_TABLE)} (id);`
      )
    } else {
      await fixtureSql(
        engine,
        `CREATE TABLE ${id(base, COMMA_PARENT)} (
          ${q('target,id')} integer, ${q('target,secret')} integer,
          PRIMARY KEY (${q('target,id')}, ${q('target,secret')}));
        CREATE TABLE ${id(OTHER, COMMA_SOURCE)} (
          ${q('source,id')} integer, ${q('source,secret')} integer,
          CONSTRAINT ${q(`g1_comma_fk_${SUFFIX}`)} FOREIGN KEY (${q('source,id')}, ${q('source,secret')})
            REFERENCES ${id(base, COMMA_PARENT)} (${q('target,id')}, ${q('target,secret')}));
        CREATE INDEX ${q(`g1_comma_index_${SUFFIX}`)} ON ${id(OTHER, COMMA_SOURCE)} (${q('source,id')}, ${q('source,secret')});`
      )
    }
  }
}, 60_000)

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

afterAll(async () => {
  for (const engine of engines) {
    const base = namespace(engine)
    const id = (schema: string, name: string) => qualified(engine, schema, name)
    if (engine === 'postgresql') {
      await fixtureSql(
        engine,
        `DROP SCHEMA IF EXISTS ${quote(engine, OTHER)} CASCADE;
        DROP VIEW IF EXISTS ${id(base, VIEW)};
        DROP TABLE IF EXISTS ${id(base, TABLE)}, ${id(base, PARENT)}, ${id(base, `audit.orders_${SUFFIX}`)} CASCADE;
        DROP TYPE IF EXISTS ${id(base, `g1_state_${SUFFIX}`)}; DROP ROLE IF EXISTS ${quote(engine, RESTRICTED)};`
      )
    } else {
      await fixtureSql(
        engine,
        `SET FOREIGN_KEY_CHECKS=0; REVOKE ALL PRIVILEGES ON ${quote(engine, OTHER)}.* FROM 'dbcli'@'%';
        DROP DATABASE IF EXISTS ${quote(engine, OTHER)};
        DROP VIEW IF EXISTS ${id(base, VIEW)}; DROP TABLE IF EXISTS ${id(base, TABLE)}, ${id(base, PARENT)}, ${id(base, COMMA_PARENT)};
        DROP USER IF EXISTS '${RESTRICTED}'@'%';`
      )
    }
  }
}, 60_000)

for (const engine of engines) {
  describe(`${engine}: qualified schema inspection in query-only agent mode`, () => {
    test('AC-01/02/04: namespace identity binds columns, enums, PK, indexes and cross-namespace FK', async () => {
      const p = await project(engine)
      for (const [schema, marker, values] of [
        [namespace(engine), 'default_marker', ['draft', 'live']],
        [OTHER, 'other_marker', ['queued', 'sent']],
      ] as const) {
        const table = await inspect(p, qualified(engine, schema, TABLE))
        expect(table).toMatchObject({
          name: TABLE,
          schema,
          tableType: 'table',
          primaryKey: ['id', 'secret_key'],
        })
        expect(table.columns.map((c) => c.name)).toEqual(['id', 'secret_key', marker, 'state'])
        expect(table.columns.find((c) => c.name === 'state')?.enumValues).toEqual([...values])
        expect(table.indexes).toContainEqual({
          name: `g1_same_index_${SUFFIX}`,
          columns: ['id', 'secret_key'],
          unique: false,
        })
        expect(table.foreignKeys).toEqual([
          {
            name: `g1_same_fk_${SUFFIX}`,
            columns: ['id', 'secret_key'],
            refSchema: schema === OTHER ? namespace(engine) : OTHER,
            refTable: PARENT,
            refColumns: ['parent_id', 'parent_secret'],
          },
        ])
      }
      const bare = await inspect(p, TABLE)
      expect(bare.columns.map((c) => c.name)).toContain('default_marker')
      expect(bare.columns.map((c) => c.name)).not.toContain('other_marker')
    }, 30_000)

    test('AC-01/06/07: views and system views have real identity, type and unknown counts', async () => {
      const p = await project(engine)
      const ordinary = await inspect(p, qualified(engine, OTHER, VIEW))
      expect(ordinary).toMatchObject({
        name: VIEW,
        schema: OTHER,
        tableType: 'view',
        estimatedRowCount: null,
        sizeCategory: null,
      })
      expect(ordinary.metadata.rowCount).toBeUndefined()
      const systemSchema = engine === 'postgresql' ? 'pg_catalog' : 'information_schema'
      const systemName = engine === 'postgresql' ? 'pg_roles' : 'TABLES'
      const system = await inspect(p, `${systemSchema}.${systemName}`)
      expect(system).toMatchObject({ name: systemName, schema: systemSchema, tableType: 'view' })
      expect(system.columns.map((c) => c.name)).toContain(
        engine === 'postgresql' ? 'rolname' : 'TABLE_NAME'
      )
      const text = await run(p, ['schema', qualified(engine, OTHER, VIEW)])
      expect(text.code).toBe(0)
      expect(text.stdout).toContain(OTHER)
      expect(text.stdout).toContain(VIEW)
      expect(text.stdout).not.toMatch(/(?:Row count|Estimated rows):\s*~?0\b|\(small\)/i)
      if (engine === 'postgresql') {
        const materialized = await inspect(p, qualified(engine, OTHER, MATERIALIZED))
        expect(materialized).toMatchObject({
          name: MATERIALIZED,
          schema: OTHER,
          tableType: 'view',
        })
        expect(materialized.columns.find((c) => c.name === 'state')?.enumValues).toEqual([
          'queued',
          'sent',
        ])
      }
    }, 30_000)

    test('AC-03: quoted dots, case and escaped quotes identify one literal object', async () => {
      const p = await project(engine)
      const name = engine === 'postgresql' ? SPECIAL : MYSQL_SPECIAL
      const output = await inspect(p, qualified(engine, OTHER, name))
      expect(output).toMatchObject({ name, schema: OTHER })
      expect(output.columns.map((c) => c.name)).toEqual(['special_marker'])
      if (engine === 'postgresql') {
        expect(
          await inspect(p, qualified(engine, 'public', `audit.orders_${SUFFIX}`))
        ).toMatchObject({ name: `audit.orders_${SUFFIX}`, schema: 'public' })
      }
    }, 30_000)

    test('AC-03/05/06: invalid and missing identities fail without writing configuration or caches', async () => {
      const p = await project(engine)
      const before = await snapshot(p)
      const badNames = [
        `${OTHER}.`,
        `.${TABLE}`,
        `x.${OTHER}.${TABLE}`,
        qualified(engine, OTHER, 'g1_absent'),
        qualified(engine, 'g1_absent', TABLE),
        engine === 'postgresql' ? '"unterminated.name' : '`unterminated.name',
      ]
      for (const name of badNames)
        expect((await run(p, ['schema', name, '--format', 'json'])).code).not.toBe(0)
      expect(await snapshot(p)).toEqual(before)
    }, 30_000)

    test('AC-05/11: qualified names reject refresh/reset combinations and never persist a scan', async () => {
      const p = await project(engine)
      const before = await snapshot(p)
      const name = qualified(engine, OTHER, TABLE)
      for (const flags of [['--refresh'], ['--reset'], ['--refresh', '--reset']]) {
        const result = await run(p, ['schema', name, ...flags, '--format', 'json'])
        expect(result.code).not.toBe(0)
        expect(await snapshot(p)).toEqual(before)
      }
      await inspect(p, name)
      expect(await snapshot(p)).toEqual(before)
    }, 30_000)

    test('AC-08: bare, qualified, glob and case-insensitive table rules protect both input forms', async () => {
      for (const rule of [
        TABLE,
        `${namespace(engine)}.${TABLE}`,
        TABLE.toUpperCase(),
        `*${TABLE.slice(3)}`,
      ]) {
        const p = await project(engine, { tables: [rule], columns: {} })
        const before = await snapshot(p)
        for (const name of [TABLE, qualified(engine, namespace(engine), TABLE)]) {
          const result = await run(p, ['schema', name, '--format', 'json'])
          expect(result.code).not.toBe(0)
          expect(result.stdout).not.toContain('default_marker')
          expect(result.stderr).not.toContain('default_marker')
        }
        expect(await snapshot(p)).toEqual(before)
        expect(await inspect(p, qualified(engine, OTHER, VIEW))).toMatchObject({ name: VIEW })
      }
    }, 30_000)

    test('AC-09: hidden source columns remove complete composite constraints in every output format', async () => {
      for (const rule of [TABLE, `${OTHER}.${TABLE}`]) {
        const p = await project(engine, {
          tables: ['g1_never_match'],
          columns: { [rule]: ['SECRET_*'] },
        })
        const table = await inspect(p, qualified(engine, OTHER, TABLE))
        expect(table.columns.map((c) => c.name)).not.toContain('secret_key')
        expect(table.primaryKey ?? []).toEqual([])
        expect(table.indexes ?? []).toEqual([])
        expect(table.foreignKeys ?? []).toEqual([])
        expect(table.columns.every((c) => c.foreignKey === undefined)).toBe(true)
        expect(JSON.stringify(table)).toMatch(/omitt/i)
        for (const format of ['json', 'table']) {
          const output = await run(p, [
            'schema',
            qualified(engine, OTHER, TABLE),
            '--format',
            format,
          ])
          expect(output.code).toBe(0)
          expect(`${output.stdout}\n${output.stderr}`).not.toMatch(
            /secret_key|g1_same_fk|g1_same_index|parent_secret/i
          )
          expect(output.stdout).toMatch(/omitt/i)
        }
      }
    }, 30_000)

    test('AC-09: target table or column protection removes table and column FK representations', async () => {
      for (const blacklist of [
        { tables: [`${namespace(engine)}.${PARENT}`], columns: {} },
        {
          tables: ['g1_never_match'],
          columns: { [`${namespace(engine)}.${PARENT}`]: ['parent_secret'] },
        },
      ]) {
        const p = await project(engine, blacklist)
        const table = await inspect(p, qualified(engine, OTHER, TABLE))
        expect(table.columns.map((c) => c.name)).toContain('secret_key')
        expect(table.foreignKeys ?? []).toEqual([])
        expect(table.columns.every((c) => c.foreignKey === undefined)).toBe(true)
        expect(JSON.stringify(table)).not.toMatch(/parent_secret|g1_same_fk/)
        expect(JSON.stringify(table)).toMatch(/omitt/i)
      }
    }, 30_000)

    test('AC-10: all columns protected remains an existing object and reports protective omission', async () => {
      const p = await project(engine, {
        tables: ['g1_never_match'],
        columns: { [`${OTHER}.${TABLE}`]: ['*'] },
      })
      const table = await inspect(p, qualified(engine, OTHER, TABLE))
      expect(table).toMatchObject({ name: TABLE, schema: OTHER, columns: [] })
      expect(table.primaryKey ?? []).toEqual([])
      expect(table.foreignKeys ?? []).toEqual([])
      expect(table.indexes ?? []).toEqual([])
      expect(JSON.stringify(table)).toMatch(/omitt/i)
    }, 30_000)

    test('AC-10/11: native account visibility is preserved without grants or config mutation', async () => {
      const p = await project(engine, undefined, true)
      const before = await snapshot(p)
      expect(await inspect(p, qualified(engine, namespace(engine), VIEW))).toMatchObject({
        name: VIEW,
        tableType: 'view',
      })
      const result = await run(p, ['schema', qualified(engine, OTHER, TABLE), '--format', 'json'])
      expect(result.code).not.toBe(0)
      expect(result.stdout).not.toContain('other_marker')
      expect(await snapshot(p)).toEqual(before)
    }, 30_000)

    if (engine === 'postgresql') {
      test('AC-04/07: an unqualified default-schema view retains its actual type and legacy count', async () => {
        const p = await project(engine)
        const view = await inspect(p, VIEW)
        expect(view).toMatchObject({ name: VIEW, tableType: 'view' })
        expect(view.columns.map((c) => c.name)).toEqual(['id', 'default_marker'])
        // The fixture is empty: the unqualified path keeps its existing count
        // behavior, while the qualified path above reports an unknown count.
        expect(String(view.metadata.rowCount)).toBe('0')
      }, 30_000)

      test('AC-09: expression and partial indexes referencing a protected column are omitted whole', async () => {
        const p = await project(engine, {
          tables: ['g1_never_match'],
          columns: { [`${OTHER}.${EXPRESSION_TABLE}`]: ['secret'] },
        })
        const table = await inspect(p, qualified(engine, OTHER, EXPRESSION_TABLE))
        expect(table.columns.map((c) => c.name)).toEqual(['id'])
        expect(table.indexes).toEqual([
          { name: `g1_safe_${SUFFIX}`, columns: ['id'], unique: false },
        ])
        expect(JSON.stringify(table)).toMatch(/omitt/i)
        for (const format of ['json', 'table']) {
          const result = await run(p, [
            'schema',
            qualified(engine, OTHER, EXPRESSION_TABLE),
            '--format',
            format,
          ])
          expect(result.code).toBe(0)
          expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
            /secret|g1_expression_secret|g1_partial_secret/i
          )
          expect(result.stdout).toContain(`g1_safe_${SUFFIX}`)
          expect(result.stdout).toMatch(/omitt/i)
        }
      }, 30_000)
    } else {
      test('AC-02/09: comma-containing composite FK and index columns retain their identity and protection', async () => {
        const p = await project(engine)
        const table = await inspect(p, qualified(engine, OTHER, COMMA_SOURCE))
        expect(table.columns.map((c) => c.name)).toEqual(['source,id', 'source,secret'])
        expect(table.foreignKeys).toEqual([
          {
            name: `g1_comma_fk_${SUFFIX}`,
            columns: ['source,id', 'source,secret'],
            refSchema: namespace(engine),
            refTable: COMMA_PARENT,
            refColumns: ['target,id', 'target,secret'],
          },
        ])
        expect(table.indexes).toContainEqual({
          name: `g1_comma_index_${SUFFIX}`,
          columns: ['source,id', 'source,secret'],
          unique: false,
        })
        const protectedProject = await project(engine, {
          tables: ['g1_never_match'],
          columns: { [`${namespace(engine)}.${COMMA_PARENT}`]: ['target,secret'] },
        })
        const protectedTable = await inspect(
          protectedProject,
          qualified(engine, OTHER, COMMA_SOURCE)
        )
        expect(protectedTable.columns.map((c) => c.name)).toEqual(['source,id', 'source,secret'])
        expect(protectedTable.foreignKeys ?? []).toEqual([])
        expect(protectedTable.columns.every((c) => c.foreignKey === undefined)).toBe(true)
        for (const format of ['json', 'table']) {
          const result = await run(protectedProject, [
            'schema',
            qualified(engine, OTHER, COMMA_SOURCE),
            '--format',
            format,
          ])
          expect(result.code).toBe(0)
          expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/target,secret|g1_comma_fk/i)
          expect(result.stdout).toMatch(/omitt/i)
        }
      }, 30_000)
    }
  })
}

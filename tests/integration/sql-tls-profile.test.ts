import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  initArgs,
  readTlsProfile,
  tlsCli,
  tlsWorkspace,
  type TlsWorkspace,
} from '../helpers/sql-tls-cli'

const workspaces: TlsWorkspace[] = []
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((work) => work.close()))
})

test('normal named init persists verified SQL TLS through profile reread and selection', async () => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  const initialized = await tlsCli(work, [
    ...initArgs('verified'),
    '--skip-test',
    '--sql-tls',
    'verify-full',
    '--sql-tls-ca',
    'trust.pem',
  ])
  expect(initialized.code, initialized.stderr).toBe(0)
  const loaded = await readTlsProfile(work, 'verified')
  expect(loaded.code, loaded.stderr).toBe(0)
  expect(JSON.parse(loaded.stdout).connection.sqlTls).toEqual({
    mode: 'verify-full',
    caPath: join(work.dir, 'trust.pem'),
  })
})

test.each(['mysql', 'mariadb', 'mongodb', 'redis', 'elasticsearch', 'sqlite'])(
  'profile read rejects explicit SQL TLS for %s instead of stripping it',
  async (system) => {
    const work = await tlsWorkspace()
    workspaces.push(work)
    await Bun.write(
      join(work.config, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'unsupported',
        connections: {
          unsupported: {
            system,
            host: 'localhost',
            port: 5432,
            user: 'dbcli',
            password: '',
            database: 'dbcli_test',
            file: '/tmp/unused.sqlite',
            sqlTls: { mode: 'verify-full', caPath: '/missing.pem' },
          },
        },
      })
    )
    const result = await readTlsProfile(work, 'unsupported')
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('SQL TLS')
  }
)

test('offline discovery exposes only PostgreSQL TLS and never loads CA, connects or modifies the profile', async () => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  const initialized = await tlsCli(work, [
    ...initArgs('offline', 1),
    '--skip-test',
    '--sql-tls',
    'verify-full',
    '--sql-tls-ca',
    '/does-not-exist.pem',
  ])
  expect(initialized.code).toBe(0)
  const before = (await readTlsProfile(work, 'offline')).stdout
  const configBefore = await Bun.file(join(work.config, 'config.json')).text()
  const catalog = await tlsCli(work, ['capabilities', '--format', 'json'])
  expect(catalog.code).toBe(0)
  const parsed = JSON.parse(catalog.stdout)
  expect(parsed.schemaVersion).toBe(1)
  expect(
    parsed.capabilities.find((entry: { id: string }) => entry.id === 'connection.tls')
  ).toMatchObject({
    command: 'query',
    engines: ['postgresql'],
    mutatesConfiguration: false,
    minimumPermission: 'query-only',
    requiresConnection: true,
  })
  const checked = await tlsCli(
    work,
    [
      '--use',
      'offline',
      'capabilities',
      'check',
      '--require',
      'connection.tls',
      '--format',
      'json',
    ],
    { DBCLI_AGENT_MODE: '1' }
  )
  expect(checked.code, checked.stderr).toBe(0)
  expect(JSON.parse(checked.stdout).results).toEqual([
    { id: 'connection.tls', status: 'available', reason: null },
  ])
  expect((await readTlsProfile(work, 'offline')).stdout).toBe(before)
  expect(await Bun.file(join(work.config, 'config.json')).text()).toBe(configBefore)
})

test('legacy V1 reads refuse CA environment references before resolving them', async () => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  await Bun.write(
    work.config,
    JSON.stringify({
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'reader',
        password: '',
        database: 'fixture',
        sqlTls: { mode: 'verify-full', caPath: { $env: 'TLS_CA' } },
      },
    })
  )
  work.env.TLS_CA = '/absolute/ca.pem'
  const read = await readTlsProfile(work)
  expect(read.code).not.toBe(0)
})

test.each(['mysql', 'mariadb', 'sqlite', 'mongodb', 'redis', 'elasticsearch'])(
  'offline TLS check does not claim support for %s',
  async (system) => {
    const work = await tlsWorkspace()
    workspaces.push(work)
    await Bun.write(
      join(work.config, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'other',
        connections: {
          other: {
            system,
            host: '127.0.0.1',
            port: 1,
            user: 'unused',
            password: '',
            database: 'unused',
            file: '/unused.sqlite',
          },
        },
      })
    )
    const result = await tlsCli(work, [
      'capabilities',
      'check',
      '--require',
      'connection.tls',
      '--format',
      'json',
    ])
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).results).toEqual([
      { id: 'connection.tls', status: 'unavailable', reason: 'engine' },
    ])
  }
)

test.each(
  [
    ['--sql-tls', 'require', '--sql-tls-ca', '/ca.pem'],
    ['--sql-tls', 'verify-full'],
    ['--sql-tls-ca', '/ca.pem'],
    ['--system', 'mysql', '--sql-tls', 'verify-full', '--sql-tls-ca', '/ca.pem'],
    ['--system', 'mariadb', '--sql-tls', 'verify-full', '--sql-tls-ca', '/ca.pem'],
  ].map((args) => ({ args }))
)('normal init refuses unsupported or incomplete explicit requirements: %j', async ({ args }) => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  const result = await tlsCli(work, [...initArgs('refused', 1), '--skip-test', ...args])
  expect(result.code).not.toBe(0)
  expect(await Bun.file(join(work.config, 'config.json')).exists()).toBe(false)
})

test('reinitializing an existing named profile cannot silently remove its TLS requirement', async () => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  expect(
    (
      await tlsCli(work, [
        ...initArgs('verified'),
        '--skip-test',
        '--sql-tls',
        'verify-full',
        '--sql-tls-ca',
        '/ca.pem',
      ])
    ).code
  ).toBe(0)
  const updated = await tlsCli(work, [...initArgs('verified'), '--skip-test'])
  expect(updated.code, updated.stderr).toBe(0)
  const loaded = await readTlsProfile(work, 'verified')
  expect(JSON.parse(loaded.stdout).connection.sqlTls).toEqual({
    mode: 'verify-full',
    caPath: '/ca.pem',
  })
})

test('V1 default-name import retains TLS even when init flags omit it', async () => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  await Bun.write(
    join(work.config, 'config.json'),
    JSON.stringify({
      connection: {
        system: 'postgresql',
        host: 'localhost',
        port: 5432,
        user: 'reader',
        password: '',
        database: 'fixture',
        sqlTls: { mode: 'verify-full', caPath: '/ca.pem' },
      },
    })
  )
  const initialized = await tlsCli(work, [...initArgs('default'), '--skip-test'])
  expect(initialized.code, initialized.stderr).toBe(0)
  const loaded = await readTlsProfile(work, 'default')
  expect(JSON.parse(loaded.stdout).connection.sqlTls).toEqual({
    mode: 'verify-full',
    caPath: '/ca.pem',
  })
})

test.each([
  { lang: 'en', text: 'Provide both' },
  { lang: 'zh-TW', text: '請同時提供' },
])('TLS input diagnostics are localized in $lang', async ({ lang, text }) => {
  const work = await tlsWorkspace()
  workspaces.push(work)
  const result = await tlsCli(
    work,
    [...initArgs('bad'), '--sql-tls', 'verify-full', '--skip-test'],
    { DBCLI_LANG: lang }
  )
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain(text)
})

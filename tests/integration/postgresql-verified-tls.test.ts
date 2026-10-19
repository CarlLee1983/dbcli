import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  startPostgresTlsFixtures,
  type PostgresTlsFixtures,
  type PostgresTlsEndpointName,
} from '../helpers/postgresql-tls-fixture'
import {
  ROOT,
  tlsProcess,
  tlsWorkspace,
  tlsCli,
  readTlsProfile,
  type TlsWorkspace,
} from '../helpers/sql-tls-cli'

import { SKIP_BY_ENV, REQUIRE_SERVICES } from './helpers'

// Only explicitly non-integration jobs opt out. Missing mandatory fixtures always fail.
describe.skipIf(SKIP_BY_ENV && !REQUIRE_SERVICES)('PostgreSQL verified TLS', () => {
  let fixtures: PostgresTlsFixtures
  const workspaces: TlsWorkspace[] = []
  beforeAll(async () => {
    fixtures = await startPostgresTlsFixtures()
  }, 120_000)
  afterAll(async () => {
    await Promise.all(workspaces.map((work) => work.close()))
    await fixtures?.close()
  }, 30_000)

  async function profile(
    endpoint: PostgresTlsEndpointName,
    caPath: string,
    skipTest = false,
    host = 'localhost'
  ) {
    const work = await tlsWorkspace()
    workspaces.push(work)
    const target = fixtures.endpoints[endpoint]
    const initialized = await tlsCli(work, [
      'init',
      '--conn-name',
      endpoint,
      '--no-interactive',
      '--system',
      'postgresql',
      '--host',
      host,
      '--port',
      String(target.port),
      '--user',
      target.user,
      '--password',
      target.password,
      '--name',
      target.database,
      '--permission',
      'query-only',
      '--sql-tls',
      'verify-full',
      '--sql-tls-ca',
      caPath,
      ...(skipTest ? ['--skip-test'] : []),
    ])
    expect(initialized.code, initialized.stderr).toBe(0)
    const loaded = await readTlsProfile(work, endpoint)
    expect(loaded.code, loaded.stderr).toBe(0)
    expect(JSON.parse(loaded.stdout).connection.sqlTls).toEqual({ mode: 'verify-full', caPath })
    return work
  }

  async function prerequisites(work: TlsWorkspace, name: string) {
    const blacklist = await tlsCli(work, ['--use', name, 'blacklist', 'list', '--format', 'json'], {
      DBCLI_AGENT_MODE: '1',
    })
    expect(blacklist.code, blacklist.stderr).toBe(0)
    for (const table of ['tls_fixture', 'pg_catalog.pg_stat_ssl']) {
      const schema = await tlsCli(work, ['--use', name, 'schema', table, '--format', 'json'], {
        DBCLI_AGENT_MODE: '1',
      })
      expect(schema.code, schema.stderr).toBe(0)
    }
  }

  test('real named CLI profile requires verified TLS and executes a read-only encrypted query', async () => {
    expect(await fixtures.observe('valid')).toEqual({ encrypted: true })
    const work = await profile('valid', fixtures.caPath)
    await prerequisites(work, 'valid')
    const result = await tlsCli(
      work,
      [
        '--use',
        'valid',
        'query',
        'SELECT id, label, (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()) AS encrypted FROM tls_fixture',
        '--format',
        'json',
      ],
      { DBCLI_AGENT_MODE: '1', PGSSLMODE: 'no-verify' }
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('verified TLS fixture')
    expect(result.stdout).toContain('"encrypted": true')
  }, 30_000)

  for (const endpoint of ['untrusted', 'expired', 'wrongHost', 'plaintext', 'valid'] as const) {
    test(`verified CLI rejects ${endpoint === 'valid' ? 'unloadable CA' : endpoint} without sending the user query or retrying plaintext`, async () => {
      expect(await fixtures.observe(endpoint)).toEqual({ encrypted: endpoint !== 'plaintext' })
      // The shared table shape is independently inspected through the verified control endpoint.
      const control = await profile('valid', fixtures.caPath)
      await prerequisites(control, 'valid')
      const caPath = endpoint === 'valid' ? '/missing-dbcli-tls-ca.pem' : fixtures.caPath
      const work = await profile(endpoint, caPath, true)
      const blacklist = await tlsCli(work, [
        '--use',
        endpoint,
        'blacklist',
        'list',
        '--format',
        'json',
      ])
      expect(blacklist.code).toBe(0)
      const checkpoint = await fixtures.logCheckpoint(endpoint)
      const marker = `tls_must_not_execute_${crypto.randomUUID().replaceAll('-', '')}`
      const result = await tlsCli(
        work,
        [
          '--use',
          endpoint,
          'query',
          `SELECT id, label FROM tls_fixture /* ${marker} */`,
          '--format',
          'json',
        ],
        { DBCLI_AGENT_MODE: '1', PGSSLMODE: 'no-verify', NODE_TLS_REJECT_UNAUTHORIZED: '0' }
      )
      expect(result.code).not.toBe(0)
      expect(result.stderr).toMatch(/TLS|SSL/)
      expect(result.stderr).not.toContain('"rejectUnauthorized": false')
      const logs = await fixtures.logsSince(endpoint, checkpoint)
      expect(logs).not.toContain(marker)
      expect(logs).not.toContain('connection authorized')
      expect(logs).not.toContain('statement:')
      if (endpoint === 'valid') expect(logs).not.toContain('connection received')
    }, 30_000)
  }

  test('each connection reloads the CA and rejects empty or malformed bundles before dialing', async () => {
    const control = await profile('valid', fixtures.caPath)
    await prerequisites(control, 'valid')
    const caPath = join(control.dir, 'changing-ca.pem')
    const validCa = await Bun.file(fixtures.caPath).text()
    await Bun.write(caPath, validCa)
    const work = await profile('valid', caPath)
    for (const contents of [
      '',
      'not a certificate',
      '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',
    ]) {
      await Bun.write(caPath, contents)
      const checkpoint = await fixtures.logCheckpoint('valid')
      const result = await tlsCli(work, [
        '--use',
        'valid',
        'query',
        'SELECT id, label FROM tls_fixture',
      ])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('SQL TLS CA')
      expect(await fixtures.logsSince('valid', checkpoint)).not.toContain('connection received')
    }
    await Bun.write(caPath, validCa)
    const recovered = await tlsCli(work, [
      '--use',
      'valid',
      'query',
      'SELECT id, label FROM tls_fixture',
    ])
    expect(recovered.code, recovered.stderr).toBe(0)
    expect(recovered.stdout).toContain('verified TLS fixture')
  }, 30_000)

  test('explicit TLS refuses Unix sockets before opening a connection', async () => {
    const work = await profile('valid', fixtures.caPath, true, '/tmp/dbcli-unavailable-socket')
    const result = await tlsCli(work, [
      '--use',
      'valid',
      'schema',
      'tls_fixture',
      '--format',
      'json',
    ])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('DNS or IP host')
  }, 30_000)

  async function configure(work: TlsWorkspace, mutation: string) {
    const result = await tlsProcess(work, [
      '-e',
      `
    import { readV2Config, writeV2Config } from ${JSON.stringify(join(ROOT, 'src/core/config-v2.ts'))};
    const config = await readV2Config(process.argv[1]);
    ${mutation}
    await writeV2Config(process.argv[1], config);
  `,
      work.config,
    ])
    expect(result.code, result.stderr).toBe(0)
  }

  test('same-process real CLI selections keep distinct profile CAs in either order', async () => {
    const work = await profile('valid', fixtures.caPath)
    const other = fixtures.endpoints.untrusted
    const added = await tlsCli(work, [
      'init',
      '--conn-name',
      'other',
      '--no-interactive',
      '--force',
      '--system',
      'postgresql',
      '--host',
      'localhost',
      '--port',
      String(other.port),
      '--user',
      other.user,
      '--password',
      other.password,
      '--name',
      other.database,
      '--sql-tls',
      'verify-full',
      '--sql-tls-ca',
      fixtures.otherCaPath,
    ])
    expect(added.code, added.stderr).toBe(0)
    await configure(
      work,
      `config.connections.wrong = { ...config.connections.valid, sqlTls: {mode:'verify-full', caPath:${JSON.stringify(fixtures.otherCaPath)}} };`
    )
    await prerequisites(work, 'valid')
    await prerequisites(work, 'other')
    const result = await tlsProcess(
      work,
      [
        '-e',
        `
    import { buildProgram } from ${JSON.stringify(join(ROOT, 'src/program.ts'))};
    for (const name of ['valid','wrong','other','wrong','valid','other']) {
      process.exitCode = 0;
      try {
        await buildProgram().parseAsync(['bun','dbcli','--config',process.argv[1],'query','SELECT id, label FROM tls_fixture','--use',name,'--format','json']);
      } catch (error) {
        if (error.code !== 'TLS_ERROR') throw error;
        process.exitCode = 1;
      }
      console.log('TLS_RESULT '+name+' '+(process.exitCode ?? 0));
    }
    process.exitCode = 0;
  `,
        work.config,
      ],
      { DBCLI_AGENT_MODE: '1', PGSSLMODE: 'no-verify' }
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout.split('\n').filter((line) => line.startsWith('TLS_RESULT'))).toEqual([
      'TLS_RESULT valid 0',
      'TLS_RESULT wrong 1',
      'TLS_RESULT other 0',
      'TLS_RESULT wrong 1',
      'TLS_RESULT valid 0',
      'TLS_RESULT other 0',
    ])
    expect((await readTlsProfile(work, 'valid')).code).toBe(0)
  }, 30_000)

  test('IP identity is verified and wrong-host IP connections stop before authentication', async () => {
    const work = await profile('valid', fixtures.caPath, false, '127.0.0.1')
    await prerequisites(work, 'valid')
    const wrong = await profile('wrongHost', fixtures.caPath, true, '127.0.0.1')
    const checkpoint = await fixtures.logCheckpoint('wrongHost')
    const result = await tlsCli(wrong, [
      '--use',
      'wrongHost',
      'query',
      'SELECT id FROM tls_fixture',
      '--format',
      'json',
    ])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/IP|altnames|certificate/)
    expect(await fixtures.logsSince('wrongHost', checkpoint)).not.toContain('connection authorized')
  }, 30_000)

  test('recovery retains TLS requirements and agent mode refuses configuration mutation', async () => {
    const work = await profile('wrongHost', fixtures.caPath, true)
    const before = (await readTlsProfile(work, 'wrongHost')).stdout
    const result = await tlsCli(
      work,
      [
        '--use',
        'wrongHost',
        'query',
        'SELECT id FROM tls_fixture',
        '--recovery',
        '--format',
        'json',
      ],
      { DBCLI_AGENT_MODE: '1' }
    )
    expect(result.code).not.toBe(0)
    expect(JSON.parse(result.stdout).ok).toBe(false)
    expect(result.stdout).not.toContain('rejectUnauthorized')
    const recovered = await tlsCli(work, ['recover', '--apply', '--format', 'json'], {
      DBCLI_AGENT_MODE: '1',
    })
    expect(recovered.stdout + recovered.stderr).not.toContain('rejectUnauthorized')
    const mutate = await tlsCli(
      work,
      [
        'init',
        '--conn-name',
        'wrongHost',
        '--no-interactive',
        '--sql-tls',
        'verify-full',
        '--sql-tls-ca',
        fixtures.otherCaPath,
        '--force',
        '--user',
        'reader',
        '--name',
        'fixture',
        '--skip-test',
      ],
      { DBCLI_AGENT_MODE: '1' }
    )
    expect(mutate.code).not.toBe(0)
    expect(mutate.stderr).toMatch(/agent mode|DBCLI_AGENT_MODE/i)
    expect((await readTlsProfile(work, 'wrongHost')).stdout).toBe(before)
  }, 30_000)

  test('environment-reference profiles retain literal trust and reach the real verified transport', async () => {
    const work = await tlsWorkspace()
    workspaces.push(work)
    const target = fixtures.endpoints.valid
    Object.assign(work.env, {
      TLS_HOST: 'localhost',
      TLS_PORT: String(target.port),
      TLS_USER: target.user,
      TLS_PASSWORD: target.password,
      TLS_DATABASE: target.database,
    })
    const initialized = await tlsCli(work, [
      'init',
      '--conn-name',
      'env',
      '--system',
      'postgresql',
      '--no-interactive',
      '--use-env-refs',
      '--env-host',
      'TLS_HOST',
      '--env-port',
      'TLS_PORT',
      '--env-user',
      'TLS_USER',
      '--env-password',
      'TLS_PASSWORD',
      '--env-database',
      'TLS_DATABASE',
      '--sql-tls',
      'verify-full',
      '--sql-tls-ca',
      fixtures.caPath,
    ])
    expect(initialized.code, initialized.stderr).toBe(0)
    await prerequisites(work, 'env')
    const result = await tlsCli(
      work,
      ['--use', 'env', 'query', 'SELECT id, label FROM tls_fixture', '--format', 'json'],
      { DBCLI_AGENT_MODE: '1' }
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('verified TLS fixture')
  }, 30_000)

  test('a legacy profile without SQL TLS keeps its existing plaintext behavior', async () => {
    const work = await tlsWorkspace()
    workspaces.push(work)
    const target = fixtures.endpoints.plaintext
    const initialized = await tlsCli(work, [
      'init',
      '--conn-name',
      'legacy',
      '--system',
      'postgresql',
      '--no-interactive',
      '--host',
      'localhost',
      '--port',
      String(target.port),
      '--user',
      target.user,
      '--password',
      target.password,
      '--name',
      target.database,
    ])
    expect(initialized.code, initialized.stderr).toBe(0)
    await prerequisites(work, 'legacy')
    const result = await tlsCli(work, [
      '--use',
      'legacy',
      'query',
      'SELECT ssl AS encrypted FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()',
      '--format',
      'json',
    ])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('"encrypted": false')
  }, 30_000)
  test.each(['directory', 'directory-default', 'file'])(
    'V1 %s profile preserves TLS through supported import or explicit refusal',
    async (kind) => {
      const work = await tlsWorkspace()
      workspaces.push(work)
      if (kind === 'file') work.config = join(work.dir, 'legacy.json')
      const target = fixtures.endpoints.valid
      const connection = {
        system: 'postgresql',
        host: 'localhost',
        port: target.port,
        user: target.user,
        password: target.password,
        database: target.database,
        sqlTls: { mode: 'verify-full', caPath: fixtures.caPath },
      }
      const setup = await tlsProcess(work, [
        '-e',
        `
      import { configModule } from ${JSON.stringify(join(ROOT, 'src/core/config.ts'))};
      await configModule.write(process.argv[1], configModule.validate(JSON.parse(process.argv[2])));
    `,
        work.config,
        JSON.stringify({ connection, permission: 'query-only' }),
      ])
      expect(setup.code, setup.stderr).toBe(0)
      const reread = await readTlsProfile(work)
      expect(reread.code, reread.stderr).toBe(0)
      expect(JSON.parse(reread.stdout).connection.sqlTls).toEqual(connection.sqlTls)
      expect((await tlsCli(work, ['blacklist', 'list', '--format', 'json'])).code).toBe(0)
      expect((await tlsCli(work, ['schema', 'tls_fixture', '--format', 'json'])).code).toBe(0)
      const queried = await tlsCli(work, [
        'query',
        'SELECT id, label FROM tls_fixture',
        '--format',
        'json',
      ])
      expect(queried.code, queried.stderr).toBe(0)
      const imported = await tlsCli(work, [
        'init',
        '--conn-name',
        kind === 'directory-default' ? 'default' : 'new',
        '--no-interactive',
        '--force',
        '--system',
        'postgresql',
        '--host',
        'localhost',
        '--port',
        String(target.port),
        '--user',
        target.user,
        '--password',
        target.password,
        '--name',
        target.database,
        ...(kind === 'directory-default'
          ? []
          : ['--sql-tls', 'verify-full', '--sql-tls-ca', fixtures.caPath]),
      ])
      if (kind === 'file') {
        expect(imported.code).not.toBe(0)
        expect(imported.stderr).toContain('SQL TLS legacy single-file import')
        expect((await readTlsProfile(work)).stdout).toBe(reread.stdout)
        return
      }
      expect(imported.code, imported.stderr).toBe(0)
      const original = await readTlsProfile(work, 'default')
      expect(original.code, original.stderr).toBe(0)
      expect(JSON.parse(original.stdout).connection.sqlTls).toEqual(connection.sqlTls)
      const after = await tlsCli(work, [
        '--use',
        'default',
        'query',
        'SELECT id, label FROM tls_fixture',
        '--format',
        'json',
      ])
      expect(after.code, after.stderr).toBe(0)
    },
    30_000
  )

  test('TLS handshake diagnostics follow the selected language without downgrade hints', async () => {
    const control = await profile('valid', fixtures.caPath)
    await prerequisites(control, 'valid')
    const work = await profile('wrongHost', fixtures.caPath, true)
    for (const [language, message, hint] of [
      ['en', 'TLS handshake failed', 'Keep verify-full'],
      ['zh-TW', 'TLS 握手失敗', '請保持 verify-full'],
    ]) {
      const result = await tlsCli(
        work,
        ['--use', 'wrongHost', 'query', 'SELECT id, label FROM tls_fixture', '--format', 'json'],
        { DBCLI_LANG: language }
      )
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(message!)
      expect(result.stderr).toContain(hint!)
      expect(result.stderr).not.toContain('rejectUnauthorized: false')
    }
  }, 30_000)
})

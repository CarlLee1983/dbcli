import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  startMysqlTlsFixtures,
  type MysqlTlsFixtures,
  type MysqlTlsEndpointName,
} from '../helpers/mysql-tls-fixture'
import {
  ROOT,
  tlsCli,
  tlsProcess,
  tlsWorkspace,
  readTlsProfile,
  type TlsWorkspace,
} from '../helpers/sql-tls-cli'
import { SKIP_BY_ENV, REQUIRE_SERVICES } from './helpers'

for (const system of ['mysql', 'mariadb'] as const) {
  describe.skipIf(SKIP_BY_ENV && !REQUIRE_SERVICES)(`${system} verified TLS`, () => {
    let fixtures: MysqlTlsFixtures
    const workspaces: TlsWorkspace[] = []
    beforeAll(async () => {
      fixtures = await startMysqlTlsFixtures(system)
    }, 180_000)
    afterAll(async () => {
      await Promise.all(workspaces.map((work) => work.close()))
      await fixtures?.close()
    }, 30_000)

    async function profile(
      endpoint: MysqlTlsEndpointName,
      caPath: string,
      skipTest = false,
      host = 'localhost',
      configDirectory = '.dbcli'
    ) {
      const work = await tlsWorkspace()
      work.config = join(work.dir, configDirectory)
      workspaces.push(work)
      const target = fixtures.endpoints[endpoint]
      const result = await tlsCli(work, [
        'init',
        '--conn-name',
        endpoint,
        '--no-interactive',
        '--system',
        system,
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
      expect(result.code, result.stderr).toBe(0)
      const loaded = await readTlsProfile(work, endpoint)
      expect(loaded.code, loaded.stderr).toBe(0)
      expect(JSON.parse(loaded.stdout).connection.sqlTls).toEqual({ mode: 'verify-full', caPath })
      return work
    }

    async function prerequisites(work: TlsWorkspace, name: string) {
      for (const args of [
        ['blacklist', 'list'],
        ['schema', 'tls_fixture'],
      ]) {
        const result = await tlsCli(work, ['--use', name, ...args, '--format', 'json'], {
          DBCLI_AGENT_MODE: '1',
        })
        expect(result.code, result.stderr).toBe(0)
      }
    }

    async function configure(work: TlsWorkspace, mutation: string) {
      const result = await tlsProcess(work, [
        '-e',
        `
        import {readV2Config,writeV2Config} from ${JSON.stringify(join(ROOT, 'src/core/config-v2.ts'))};
        const config=await readV2Config(process.argv[1]); ${mutation}
        await writeV2Config(process.argv[1],config);
      `,
        work.config,
      ])
      expect(result.code, result.stderr).toBe(0)
    }

    test('normal named profile executes a verified encrypted read through the real CLI', async () => {
      const observed = await fixtures.observe('valid')
      expect(observed.encrypted).toBe(true)
      console.log(JSON.stringify({ system, image: fixtures.image, ...observed }))
      const work = await profile('valid', fixtures.caPath)
      await prerequisites(work, 'valid')
      const checkpoint = await fixtures.logCheckpoint('valid')
      const result = await tlsCli(
        work,
        ['--use', 'valid', 'query', 'SELECT id, label FROM tls_fixture', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1', NODE_TLS_REJECT_UNAUTHORIZED: '0' }
      )
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain('verified TLS fixture')
      const logs = await fixtures.logsSince('valid', checkpoint)
      expect(logs).toContain('SELECT id, label FROM tls_fixture')
      expect(logs).toMatch(/Connect\s+dbcli_tls.*using SSL\/TLS/)
    }, 30_000)

    for (const endpoint of ['untrusted', 'expired', 'wrongHost', 'plaintext', 'valid'] as const) {
      test(`rejects ${endpoint === 'valid' ? 'unloadable CA' : endpoint} before authentication without plaintext retry`, async () => {
        const observed = await fixtures.observe(endpoint)
        expect(observed.encrypted).toBe(endpoint !== 'plaintext')
        console.log(JSON.stringify({ system, endpoint, ...observed }))
        const control = await profile('valid', fixtures.caPath)
        await prerequisites(control, 'valid')
        const work = await profile(
          endpoint,
          endpoint === 'valid' ? join(control.dir, 'missing.pem') : fixtures.caPath,
          true
        )
        expect(
          (await tlsCli(work, ['--use', endpoint, 'blacklist', 'list', '--format', 'json'])).code
        ).toBe(0)
        const count = await fixtures.connectionCount(endpoint)
        const checkpoint = await fixtures.logCheckpoint(endpoint)
        const marker = `must_not_execute_${crypto.randomUUID().replaceAll('-', '')}`
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
          { DBCLI_AGENT_MODE: '1', NODE_TLS_REJECT_UNAUTHORIZED: '0', PGSSLMODE: 'no-verify' }
        )
        expect(result.code).not.toBe(0)
        expect(result.stderr).toMatch(/TLS|SSL/)
        const logs = await fixtures.logsSince(endpoint, checkpoint)
        expect(logs).not.toContain(marker)
        expect(logs).not.toMatch(/Connect\s+dbcli_tls/)
        expect(logs).not.toMatch(/\b(?:Query|Prepare|Execute)\s/)
        expect((await fixtures.connectionCount(endpoint)) - count).toBe(
          endpoint === 'valid' ? 0 : 1
        )
      }, 30_000)
    }

    test('IP-only SAN works and a DNS localhost SAN cannot authenticate an IP target', async () => {
      const good = await profile('ipOnly', fixtures.caPath, false, '127.0.0.1')
      await prerequisites(good, 'ipOnly')
      const result = await tlsCli(good, [
        '--use',
        'ipOnly',
        'query',
        'SELECT id FROM tls_fixture',
        '--format',
        'json',
      ])
      expect(result.code, result.stderr).toBe(0)
      for (const endpoint of ['dnsOnly', 'wrongHost'] as const) {
        expect((await fixtures.observe(endpoint)).encrypted).toBe(true)
        const work = await profile(endpoint, fixtures.caPath, true, '127.0.0.1')
        const checkpoint = await fixtures.logCheckpoint(endpoint)
        const failed = await tlsCli(
          work,
          ['--use', endpoint, 'query', 'SELECT id FROM tls_fixture', '--format', 'json'],
          { NODE_TLS_REJECT_UNAUTHORIZED: '0' }
        )
        expect(failed.code).not.toBe(0)
        expect(failed.stderr).toMatch(/IP|altnames|certificate/)
        expect(await fixtures.logsSince(endpoint, checkpoint)).not.toMatch(
          /Connect\s+dbcli_tls|\b(?:Query|Prepare|Execute)\s/
        )
      }
    }, 30_000)

    test('CA is reloaded on every connection and invalid bundles fail before dialing', async () => {
      const work = await profile('valid', fixtures.caPath)
      await prerequisites(work, 'valid')
      const caPath = join(work.dir, 'reload.pem')
      const ca = await Bun.file(fixtures.caPath).text()
      await Bun.write(caPath, ca)
      await configure(work, `config.connections.valid.sqlTls.caPath=${JSON.stringify(caPath)};`)
      for (const contents of [
        ca,
        '',
        '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',
        ca,
      ]) {
        await Bun.write(caPath, contents)
        const count = await fixtures.connectionCount('valid')
        const result = await tlsCli(work, [
          '--use',
          'valid',
          'query',
          'SELECT id FROM tls_fixture',
          '--format',
          'json',
        ])
        expect(result.code, result.stderr).toBe(contents === ca ? 0 : 1)
        expect((await fixtures.connectionCount('valid')) - count).toBe(contents === ca ? 1 : 0)
      }
      const socket = await profile('valid', fixtures.caPath, true, '/tmp/not-a-tls-network-host')
      const count = await fixtures.connectionCount('valid')
      const failed = await tlsCli(socket, [
        '--use',
        'valid',
        'schema',
        'tls_fixture',
        '--format',
        'json',
      ])
      expect(failed.code).not.toBe(0)
      expect(failed.stderr).toContain('DNS or IP host')
      expect((await fixtures.connectionCount('valid')) - count).toBe(0)
    }, 30_000)

    test('agent mode can use existing TLS but recovery and init cannot weaken its trust', async () => {
      const control = await profile('valid', fixtures.caPath)
      await prerequisites(control, 'valid')
      const work = await profile('wrongHost', fixtures.caPath, true, 'localhost', 'selected-config')
      const plain = fixtures.endpoints.plaintext
      await configure(
        work,
        `config.connections.plain={...config.connections.wrongHost,port:${plain.port}}; delete config.connections.plain.sqlTls; config.default='plain';`
      )
      const before = (await readTlsProfile(work, 'wrongHost')).stdout
      const checkpoint = await fixtures.logCheckpoint('wrongHost')
      const failed = await tlsCli(
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
      expect(failed.code).not.toBe(0)
      expect(JSON.parse(failed.stdout).ok).toBe(false)
      const plainCount = await fixtures.connectionCount('plaintext')
      const recovery = await tlsCli(work, ['recover', '--apply', '--format', 'json'], {
        DBCLI_AGENT_MODE: '1',
      })
      expect(recovery.code).not.toBe(0)
      expect(recovery.stdout + recovery.stderr).not.toContain('rejectUnauthorized')
      expect((await fixtures.connectionCount('plaintext')) - plainCount).toBe(0)
      const plainRetry = await tlsCli(
        work,
        ['--use', 'plain', 'recover', '--apply', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(plainRetry.code).not.toBe(0)
      expect((await fixtures.connectionCount('plaintext')) - plainCount).toBe(0)
      const count = await fixtures.connectionCount('wrongHost')
      const explicit = await tlsCli(
        work,
        ['--use', 'wrongHost', 'recover', '--apply', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(explicit.code).not.toBe(0)
      expect(explicit.stdout + explicit.stderr).toMatch(/TLS|SSL/)
      expect((await fixtures.connectionCount('wrongHost')) - count).toBeGreaterThan(0)
      const mutate = await tlsCli(
        work,
        [
          'init',
          '--conn-name',
          'wrongHost',
          '--no-interactive',
          '--force',
          '--skip-test',
          '--system',
          system,
          '--user',
          'reader',
          '--name',
          'fixture',
          '--sql-tls',
          'verify-full',
          '--sql-tls-ca',
          fixtures.otherCaPath,
        ],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(mutate.code).not.toBe(0)
      expect(mutate.stderr).toMatch(/agent mode|DBCLI_AGENT_MODE/i)
      expect((await readTlsProfile(work, 'wrongHost')).stdout).toBe(before)
      expect(await fixtures.logsSince('wrongHost', checkpoint)).not.toMatch(
        /Connect\s+dbcli_tls|\b(?:Prepare|Execute)\s/
      )
    }, 30_000)

    test('production selection, permission, blacklist, write gate and audit still govern TLS queries', async () => {
      const work = await profile('valid', fixtures.caPath)
      await prerequisites(work, 'valid')
      expect(
        (await tlsCli(work, ['--use', 'valid', 'schema', 'fixture_secret', '--format', 'json']))
          .code
      ).toBe(0)
      await configure(
        work,
        `config.default='valid'; config.connections.valid.environment='production'; config.blacklist={tables:['fixture_secret'],columns:{}};`
      )
      const count = await fixtures.connectionCount('valid')
      const implicit = await tlsCli(
        work,
        ['query', 'SELECT id FROM tls_fixture', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(implicit.code).not.toBe(0)
      expect(implicit.stderr).toContain('production')
      expect((await fixtures.connectionCount('valid')) - count).toBe(0)
      const allowed = await tlsCli(
        work,
        ['--use', 'valid', 'query', 'SELECT id, label FROM tls_fixture', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(allowed.code, allowed.stderr).toBe(0)
      const blocked = await tlsCli(
        work,
        ['--use', 'valid', 'query', 'SELECT id, secret FROM fixture_secret', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(blocked.code).not.toBe(0)
      expect(blocked.stderr).toMatch(/blacklist|blocked/i)
      const permission = await tlsCli(
        work,
        ['--use', 'valid', 'query', 'DELETE FROM tls_fixture', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(permission.code).not.toBe(0)
      expect(permission.stderr).toMatch(/permission|query-only/i)
      await configure(work, `config.connections.valid.permission='admin';`)
      const checkpoint = await fixtures.logCheckpoint('valid')
      const gate = await tlsCli(
        work,
        ['--use', 'valid', 'query', 'DELETE FROM tls_fixture', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(gate.code).not.toBe(0)
      expect(await fixtures.logsSince('valid', checkpoint)).not.toContain('DELETE FROM tls_fixture')
      const audit = await tlsCli(work, [
        '--use',
        'valid',
        'audit',
        'tail',
        '--n',
        '50',
        '--format',
        'json',
      ])
      expect(audit.code, audit.stderr).toBe(0)
      const entries = JSON.parse(audit.stdout) as {
        command: string
        success: boolean
        engine: string
      }[]
      expect(
        entries.some(
          (entry) => entry.command === 'query' && entry.success && entry.engine === system
        )
      ).toBe(true)
      expect(entries.some((entry) => !entry.success)).toBe(true)
    }, 30_000)

    test('TLS does not bypass native read-only transactions or native table privileges', async () => {
      const work = await profile('valid', fixtures.caPath)
      await prerequisites(work, 'valid')
      for (const table of ['fixture_write_probe', 'fixture_denied']) {
        const schema = await tlsCli(work, [
          '--use',
          'valid',
          'schema',
          `dbcli_tls.${table}`,
          '--format',
          'json',
        ])
        expect(schema.code, schema.stderr).toBe(0)
      }
      const checkpoint = await fixtures.logCheckpoint('valid')
      const write = await tlsCli(
        work,
        ['--use', 'valid', 'query', 'SELECT tls_attempt_write() AS result', '--format', 'json'],
        { DBCLI_AGENT_MODE: '1' }
      )
      expect(write.code).not.toBe(0)
      expect(write.stderr).toMatch(/read.only|1792/i)
      expect(await fixtures.logsSince('valid', checkpoint)).toContain('START TRANSACTION READ ONLY')
      const unchanged = await tlsCli(work, [
        '--use',
        'valid',
        'query',
        'SELECT COUNT(*) AS remaining FROM fixture_write_probe',
        '--format',
        'json',
      ])
      expect(unchanged.code, unchanged.stderr).toBe(0)
      expect(unchanged.stdout).toContain('"remaining": 0')
      const denied = await tlsCli(work, [
        '--use',
        'valid',
        'query',
        'SELECT id FROM fixture_denied',
        '--format',
        'json',
        '--recovery',
      ])
      expect(denied.code).not.toBe(0)
      expect(denied.stdout + denied.stderr).toContain('DB_PERMISSION_DENIED')
    }, 30_000)

    test('profiles without explicit TLS retain their plaintext behavior', async () => {
      const work = await profile('plaintext', fixtures.caPath, true)
      await configure(work, `delete config.connections.plaintext.sqlTls;`)
      await prerequisites(work, 'plaintext')
      const checkpoint = await fixtures.logCheckpoint('plaintext')
      const result = await tlsCli(work, [
        '--use',
        'plaintext',
        'query',
        'SELECT id, label FROM tls_fixture',
        '--format',
        'json',
      ])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain('verified TLS fixture')
      expect(await fixtures.logsSince('plaintext', checkpoint)).toMatch(
        /Connect\s+dbcli_tls.*using TCP\/IP/
      )
    }, 30_000)

    test('environment-reference profiles retain literal trust through the real CLI', async () => {
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
        system,
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

    test.each(['directory', 'directory-default', 'file'])(
      'V1 %s preserves TLS through import or explicit refusal',
      async (kind) => {
        const work = await tlsWorkspace()
        workspaces.push(work)
        if (kind === 'file') work.config = join(work.dir, 'legacy.json')
        const target = fixtures.endpoints.valid
        const connection = {
          system,
          host: 'localhost',
          port: target.port,
          user: target.user,
          password: target.password,
          database: target.database,
          sqlTls: { mode: 'verify-full', caPath: fixtures.caPath },
        }
        const setup = await tlsProcess(work, [
          '-e',
          `import {configModule} from ${JSON.stringify(join(ROOT, 'src/core/config.ts'))}; await configModule.write(process.argv[1],configModule.validate(JSON.parse(process.argv[2])));`,
          work.config,
          JSON.stringify({ connection, permission: 'query-only' }),
        ])
        expect(setup.code, setup.stderr).toBe(0)
        const reread = await readTlsProfile(work)
        expect(JSON.parse(reread.stdout).connection.sqlTls).toEqual(connection.sqlTls)
        for (const args of [
          ['blacklist', 'list'],
          ['schema', 'tls_fixture'],
        ])
          expect((await tlsCli(work, [...args, '--format', 'json'])).code).toBe(0)
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
          system,
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
        } else {
          expect(imported.code, imported.stderr).toBe(0)
          expect(
            JSON.parse((await readTlsProfile(work, 'default')).stdout).connection.sqlTls
          ).toEqual(connection.sqlTls)
          expect(
            (
              await tlsCli(work, [
                '--use',
                'default',
                'query',
                'SELECT id FROM tls_fixture',
                '--format',
                'json',
              ])
            ).code
          ).toBe(0)
        }
      },
      30_000
    )
  })
}

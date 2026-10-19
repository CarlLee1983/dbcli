import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { startMysqlTlsFixtures, type MysqlTlsFixtures } from '../helpers/mysql-tls-fixture'
import {
  startPostgresTlsFixtures,
  type PostgresTlsFixtures,
} from '../helpers/postgresql-tls-fixture'
import { ROOT, tlsCli, tlsProcess, tlsWorkspace, type TlsWorkspace } from '../helpers/sql-tls-cli'
import { SKIP_BY_ENV, REQUIRE_SERVICES } from './helpers'

describe.skipIf(SKIP_BY_ENV && !REQUIRE_SERVICES)('SQL TLS trust isolation', () => {
  let mysql: MysqlTlsFixtures<'valid' | 'untrusted'>
  let mariadb: MysqlTlsFixtures<'valid' | 'untrusted'>
  let postgresql: PostgresTlsFixtures
  let work: TlsWorkspace
  beforeAll(async () => {
    work = await tlsWorkspace()
    mysql = await startMysqlTlsFixtures('mysql', ['valid', 'untrusted'])
    mariadb = await startMysqlTlsFixtures('mariadb', ['valid', 'untrusted'])
    postgresql = await startPostgresTlsFixtures()
  }, 180_000)
  afterAll(async () => {
    await Promise.all([mysql?.close(), mariadb?.close(), postgresql?.close(), work?.close()])
  }, 30_000)

  test('same-process CLI selections retain each engine and profile CA under weak ambient settings', async () => {
    for (const [system, fixture] of Object.entries({ mysql, mariadb, postgresql })) {
      for (const name of ['valid', 'other', 'wrong'] as const) {
        const target = fixture.endpoints[name === 'other' ? 'untrusted' : 'valid']
        const initialized = await tlsCli(work, [
          'init',
          '--conn-name',
          `${system}_${name}`,
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
          '--permission',
          'query-only',
          '--sql-tls',
          'verify-full',
          '--sql-tls-ca',
          name === 'valid' ? fixture.caPath : fixture.otherCaPath,
          ...(name === 'wrong' ? ['--skip-test'] : []),
        ])
        expect(initialized.code, initialized.stderr).toBe(0)
        if (name !== 'wrong') {
          for (const args of [
            ['blacklist', 'list'],
            ['schema', 'tls_fixture'],
          ]) {
            const result = await tlsCli(
              work,
              ['--use', `${system}_${name}`, ...args, '--format', 'json'],
              { DBCLI_AGENT_MODE: '1' }
            )
            expect(result.code, result.stderr).toBe(0)
          }
        }
      }
    }
    const order = [
      'mysql_valid',
      'mysql_wrong',
      'mariadb_valid',
      'postgresql_valid',
      'mariadb_wrong',
      'mysql_other',
      'postgresql_wrong',
      'mariadb_other',
      'postgresql_other',
      'mysql_wrong',
      'mariadb_wrong',
      'postgresql_wrong',
      'mysql_valid',
      'mariadb_valid',
      'postgresql_valid',
      'postgresql_other',
      'mariadb_other',
      'mysql_other',
    ]
    const result = await tlsProcess(
      work,
      [
        '-e',
        `
      import {buildProgram} from ${JSON.stringify(join(ROOT, 'src/program.ts'))};
      for(const name of JSON.parse(process.argv[2])) {
        process.exitCode=0;
        try {
          await buildProgram().parseAsync(['bun','dbcli','--config',process.argv[1],'--use',name,'query','SELECT id, label FROM tls_fixture','--format','json']);
        } catch(error) {
          if(error.code!=='TLS_ERROR') throw error;
          process.exitCode=1;
        }
        console.log('TLS_RESULT '+name+' '+(process.exitCode??0));
      }
      process.exitCode=0;
    `,
        work.config,
        JSON.stringify(order),
      ],
      { DBCLI_AGENT_MODE: '1', NODE_TLS_REJECT_UNAUTHORIZED: '0', PGSSLMODE: 'no-verify' }
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout.split('\n').filter((line) => line.startsWith('TLS_RESULT'))).toEqual(
      order.map((name) => `TLS_RESULT ${name} ${name.endsWith('_wrong') ? 1 : 0}`)
    )
    expect(result.stdout.match(/verified TLS fixture/g)?.length).toBe(12)
  }, 60_000)
})

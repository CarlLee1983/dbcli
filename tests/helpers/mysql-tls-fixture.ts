import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTlsCertificates } from './tls-certificates'

export type MysqlTlsEndpointName =
  | 'valid'
  | 'untrusted'
  | 'expired'
  | 'wrongHost'
  | 'plaintext'
  | 'ipOnly'
  | 'dnsOnly'

export interface MysqlTlsEndpoint {
  name: MysqlTlsEndpointName
  container: string
  host: string
  port: number
  user: string
  password: string
  database: string
}

export interface MysqlTlsFixtures<N extends MysqlTlsEndpointName = MysqlTlsEndpointName> {
  caPath: string
  otherCaPath: string
  image: string
  endpoints: Record<N, MysqlTlsEndpoint>
  /** Independent session; disables certificate validation only to measure fixture encryption. */
  observe(name: N): Promise<{
    encrypted: boolean
    engineVersion: string
    cipher: string
  }>
  logs(name: N): Promise<string>
  logCheckpoint(name: N): Promise<number>
  logsSince(name: N, checkpoint: number): Promise<string>
  /** Differences exclude this method's own socket sessions; other clients count, even pre-auth. */
  connectionCount(name: N): Promise<number>
  close(): Promise<void>
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const NAMES: MysqlTlsEndpointName[] = [
  'valid',
  'untrusted',
  'expired',
  'wrongHost',
  'plaintext',
  'ipOnly',
  'dnsOnly',
]

async function command(args: string[], env?: Record<string, string>) {
  const child = Bun.spawn(args, {
    cwd: ROOT,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`Fixture ${args[0]} ${args[1]} failed (${code}): ${stderr}`)
  return stdout.trim()
}

/** Owns only randomly named disposable services. Missing Docker/OpenSSL is a failure, never a skip. */
export function startMysqlTlsFixtures(system: 'mysql' | 'mariadb'): Promise<MysqlTlsFixtures>
export function startMysqlTlsFixtures<N extends MysqlTlsEndpointName>(
  system: 'mysql' | 'mariadb',
  names: readonly N[]
): Promise<MysqlTlsFixtures<N>>
export async function startMysqlTlsFixtures<N extends MysqlTlsEndpointName = MysqlTlsEndpointName>(
  system: 'mysql' | 'mariadb',
  selectedNames?: readonly N[]
): Promise<MysqlTlsFixtures<N>> {
  const names = (selectedNames ?? NAMES) as readonly N[]
  const image = system === 'mysql' ? 'mysql:8.4' : 'mariadb:11'
  const client = system === 'mysql' ? 'mysql' : 'mariadb'
  const directory = await mkdtemp(join(tmpdir(), `dbcli-${system}-tls-`))
  const containers: string[] = []
  const endpoints = {} as Record<N, MysqlTlsEndpoint>
  const password = crypto.randomUUID()
  const rootPassword = crypto.randomUUID()
  const suffix = crypto.randomUUID().slice(0, 12)
  const close = async () => {
    const results = await Promise.allSettled(
      containers.map(async (container) => {
        try {
          await command(['docker', 'rm', '-f', '-v', container])
        } catch (error) {
          const remaining = await command([
            'docker',
            'ps',
            '-aq',
            '--filter',
            `name=^/${container}$`,
          ])
          if (remaining) throw error
        }
      })
    )
    await rm(directory, { recursive: true, force: true })
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Could not remove disposable MySQL TLS containers')
    }
    containers.length = 0
  }
  const admin = (name: N, sql: string) =>
    command([
      'docker',
      'exec',
      '-e',
      `MYSQL_PWD=${rootPassword}`,
      endpoints[name].container,
      client,
      '--protocol=socket',
      ...(system === 'mariadb' ? ['--skip-ssl'] : []),
      '-uroot',
      '--batch',
      '--skip-column-names',
      '-e',
      sql,
    ])
  try {
    await command(['docker', 'info', '--format', '{{.ServerVersion}}'])
    await createTlsCertificates(directory, [...names])
    if (names.some((name) => name === 'plaintext')) await mkdir(join(directory, 'plaintext'))
    await Bun.write(
      join(directory, 'bootstrap.sql'),
      [
        'CREATE DATABASE dbcli_tls;',
        `CREATE USER 'dbcli_tls'@'%' IDENTIFIED BY '${password}';`,
        'CREATE TABLE dbcli_tls.tls_fixture (id INT PRIMARY KEY, label VARCHAR(100) NOT NULL);',
        "INSERT INTO dbcli_tls.tls_fixture VALUES (1, 'verified TLS fixture');",
        'CREATE TABLE dbcli_tls.fixture_secret (id INT PRIMARY KEY, secret VARCHAR(100) NOT NULL);',
        "INSERT INTO dbcli_tls.fixture_secret VALUES (1, 'disposable fixture secret');",
        'CREATE TABLE dbcli_tls.fixture_write_probe (id INT);',
        'CREATE TABLE dbcli_tls.fixture_denied (id INT);',
        'DELIMITER $$',
        'CREATE DEFINER=CURRENT_USER FUNCTION dbcli_tls.tls_attempt_write() RETURNS INT',
        'DETERMINISTIC MODIFIES SQL DATA SQL SECURITY DEFINER',
        'BEGIN INSERT INTO dbcli_tls.fixture_write_probe VALUES (1); RETURN 1; END$$',
        'DELIMITER ;',
        ...['tls_fixture', 'fixture_secret', 'fixture_write_probe'].map(
          (table) => `GRANT SELECT ON dbcli_tls.${table} TO 'dbcli_tls'@'%';`
        ),
        "GRANT REFERENCES ON dbcli_tls.fixture_denied TO 'dbcli_tls'@'%';",
        "GRANT EXECUTE ON FUNCTION dbcli_tls.tls_attempt_write TO 'dbcli_tls'@'%';",
        '',
      ].join('\n')
    )
    for (const name of names) {
      const container = `dbcli-${system}-tls-${suffix}-${name.toLowerCase()}`
      containers.push(container)
      await command([
        'docker',
        'run',
        '-d',
        '--rm',
        '--name',
        container,
        '-p',
        '127.0.0.1::3306',
        '-e',
        `MYSQL_ROOT_PASSWORD=${rootPassword}`,
        '-v',
        `${join(directory, name)}:/fixture:ro`,
        '-v',
        `${join(directory, 'bootstrap.sql')}:/docker-entrypoint-initdb.d/fixture.sql:ro`,
        '--entrypoint',
        'sh',
        image,
        '-c',
        'mkdir /tmp/tls && cp /fixture/* /tmp/tls/ 2>/dev/null; chown -R mysql:mysql /tmp/tls && chmod 600 /tmp/tls/* 2>/dev/null; exec docker-entrypoint.sh "$@"',
        'sh',
        system === 'mysql' ? 'mysqld' : 'mariadbd',
        ...(name === 'plaintext'
          ? [system === 'mysql' ? '--tls-version=' : '--skip-ssl']
          : ['--ssl-cert=/tmp/tls/server.crt', '--ssl-key=/tmp/tls/server.key']),
        '--general-log=ON',
        '--general-log-file=/var/lib/mysql/fixture-general.log',
        '--log-output=FILE',
      ])
      const published = await command(['docker', 'port', container, '3306/tcp'])
      const port = Number(published.split(':').at(-1))
      if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid ${name} published port`)
      endpoints[name] = {
        name,
        container,
        host: '127.0.0.1',
        port,
        user: 'dbcli_tls',
        password,
        database: 'dbcli_tls',
      }
    }
    for (const name of names) {
      const deadline = Date.now() + 90_000
      let ready = false
      let failure: unknown
      while (Date.now() < deadline) {
        try {
          // Entrypoint initialization uses a temporary socket server. Require the final
          // TCP listener without using the certificate/profile that the test will reject.
          await admin(name, 'SELECT label FROM dbcli_tls.tls_fixture WHERE id=1')
          const state = await command([
            'docker',
            'exec',
            endpoints[name].container,
            'sh',
            '-c',
            'cat /proc/net/tcp /proc/net/tcp6',
          ])
          if (!state.split('\n').some((line) => /:0CEA\s+\S+\s+0A\s/.test(line))) {
            throw new Error('Final TCP listener is not ready')
          }
          if (['valid', 'ipOnly', 'dnsOnly'].includes(name)) {
            await admin(name, "ALTER USER 'dbcli_tls'@'%' REQUIRE SSL")
          }
          ready = true
          break
        } catch (error) {
          failure = error
          await Bun.sleep(250)
        }
      }
      if (!ready)
        throw new Error(`Disposable ${system} ${name} failed readiness: ${String(failure)}`)
    }
    const observe = async (name: N) => {
      const output = await command(
        [
          process.execPath,
          '--no-env-file',
          '-e',
          `
          import mysql from 'mysql2/promise';
          const c = await mysql.createConnection({host:'127.0.0.1',port:Number(process.env.FIXTURE_PORT),
            user:'dbcli_tls',password:process.env.FIXTURE_PASSWORD,database:'dbcli_tls',connectTimeout:3000,
            ssl:process.env.FIXTURE_TLS==='yes'?{rejectUnauthorized:false,verifyIdentity:false}:undefined});
          try {
            const [status] = await c.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
            const [version] = await c.query('SELECT VERSION() AS engineVersion');
            const cipher = status[0].Value;
            console.log(JSON.stringify({encrypted:cipher.length>0,cipher,engineVersion:version[0].engineVersion}));
          } finally { await c.end(); }
        `,
        ],
        {
          PATH: process.env.PATH ?? '',
          FIXTURE_PORT: String(endpoints[name].port),
          FIXTURE_PASSWORD: password,
          FIXTURE_TLS: name === 'plaintext' ? 'no' : 'yes',
        }
      )
      const result: { encrypted: boolean; engineVersion: string; cipher: string } =
        JSON.parse(output)
      if (result.encrypted !== (name !== 'plaintext'))
        throw new Error(`Unexpected ${name} encryption state`)
      return result
    }
    const logs = (name: N) =>
      command([
        'docker',
        'exec',
        endpoints[name].container,
        'cat',
        '/var/lib/mysql/fixture-general.log',
      ])
    const counterObservations = Object.fromEntries(names.map((name) => [name, 0])) as Record<
      N,
      number
    >
    return {
      caPath: join(directory, 'ca.crt'),
      otherCaPath: join(directory, 'other-ca.crt'),
      image,
      endpoints,
      observe,
      logs,
      logCheckpoint: async (name) => (await logs(name)).length,
      logsSince: async (name, checkpoint) => (await logs(name)).slice(checkpoint),
      connectionCount: async (name) => {
        const output = await admin(name, "SHOW GLOBAL STATUS LIKE 'Connections'")
        counterObservations[name]++
        const count = Number(output.split(/\s+/).at(-1))
        if (!Number.isFinite(count)) throw new Error(`Invalid ${name} connection counter`)
        return count - counterObservations[name]
      },
      close,
    }
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'TLS fixture startup and cleanup failed')
    }
    throw error
  }
}

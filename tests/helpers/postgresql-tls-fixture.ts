import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type PostgresTlsEndpointName = 'valid' | 'untrusted' | 'expired' | 'wrongHost' | 'plaintext'

export interface PostgresTlsEndpoint {
  name: PostgresTlsEndpointName
  container: string
  host: string
  port: number
  user: string
  password: string
  database: string
}

export interface PostgresTlsFixtures {
  caPath: string
  otherCaPath: string
  endpoints: Record<PostgresTlsEndpointName, PostgresTlsEndpoint>
  /** Independent disposable client: certificate validation is disabled ONLY for fixture health. */
  observe(name: PostgresTlsEndpointName): Promise<{ encrypted: boolean }>
  logs(name: PostgresTlsEndpointName): Promise<string>
  /** Capture before a CLI attempt; logsSince returns only newly appended peer output. */
  logCheckpoint(name: PostgresTlsEndpointName): Promise<number>
  logsSince(name: PostgresTlsEndpointName, checkpoint: number): Promise<string>
  close(): Promise<void>
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const NAMES: PostgresTlsEndpointName[] = ['valid', 'untrusted', 'expired', 'wrongHost', 'plaintext']

async function command(args: string[], cwd = ROOT, env?: Record<string, string>) {
  const child = Bun.spawn(args, { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`Fixture ${args[0]} ${args[1]} failed (${code}): ${stderr}`)
  return stdout.trim()
}

async function certificates(directory: string) {
  const openssl = (...args: string[]) => command(['openssl', ...args], directory)
  for (const root of ['ca', 'other-ca']) {
    await openssl(
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${root}.key`,
      '-out',
      `${root}.crt`,
      '-days',
      '3',
      '-subj',
      `/CN=Disposable dbcli ${root}`,
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign'
    )
  }
  for (const name of NAMES.filter((name) => name !== 'plaintext')) {
    await mkdir(join(directory, name))
    const sans = name === 'wrongHost' ? 'DNS:wrong.invalid' : 'DNS:localhost,IP:127.0.0.1'
    await Bun.write(
      join(directory, name, 'extensions.cnf'),
      [
        '[server]',
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        `subjectAltName=${sans}`,
        '',
      ].join('\n')
    )
    await openssl(
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${name}/server.key`,
      '-out',
      `${name}/server.csr`,
      '-subj',
      '/CN=Disposable PostgreSQL'
    )
    const root = name === 'untrusted' ? 'other-ca' : 'ca'
    if (name === 'expired') {
      await Bun.write(join(directory, 'index.txt'), '')
      await Bun.write(join(directory, 'serial'), '1000\n')
      await Bun.write(
        join(directory, 'ca.cnf'),
        [
          '[ca]',
          'default_ca=fixture',
          '[fixture]',
          'database=index.txt',
          'serial=serial',
          'new_certs_dir=.',
          'certificate=ca.crt',
          'private_key=ca.key',
          'default_md=sha256',
          'policy=policy',
          '[policy]',
          'commonName=supplied',
          '',
        ].join('\n')
      )
      await openssl(
        'ca',
        '-batch',
        '-config',
        'ca.cnf',
        '-in',
        `${name}/server.csr`,
        '-out',
        `${name}/server.crt`,
        '-startdate',
        '20200101000000Z',
        '-enddate',
        '20200102000000Z',
        '-extfile',
        `${name}/extensions.cnf`,
        '-extensions',
        'server'
      )
    } else {
      await openssl(
        'x509',
        '-req',
        '-in',
        `${name}/server.csr`,
        '-CA',
        `${root}.crt`,
        '-CAkey',
        `${root}.key`,
        '-set_serial',
        String(NAMES.indexOf(name) + 1),
        '-out',
        `${name}/server.crt`,
        '-days',
        '2',
        '-extfile',
        `${name}/extensions.cnf`,
        '-extensions',
        'server'
      )
    }
  }
}

/** Starts only disposable services; unavailable Docker/OpenSSL is an explicit failure, never a skip. */
export async function startPostgresTlsFixtures(): Promise<PostgresTlsFixtures> {
  const directory = await mkdtemp(join(tmpdir(), 'dbcli-pg-tls-'))
  const containers: string[] = []
  const endpoints = {} as Record<PostgresTlsEndpointName, PostgresTlsEndpoint>
  const password = crypto.randomUUID()
  const suffix = crypto.randomUUID().slice(0, 12)
  const close = async () => {
    const results = await Promise.allSettled(
      containers.map(async (container) => {
        try {
          await command(['docker', 'rm', '-f', '-v', container])
        } catch (error) {
          // A failed run (or --rm after a crash) can leave no container to remove.
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
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length)
      throw new Error(`Could not remove ${failures.length} disposable TLS containers`)
    containers.length = 0
  }
  try {
    await certificates(directory)
    await mkdir(join(directory, 'plaintext'))
    for (const name of NAMES) {
      const hba = [
        'local all all trust',
        ...(name === 'valid'
          ? ['hostnossl all all all reject', 'hostssl all all all scram-sha-256']
          : ['host all all all scram-sha-256']),
        '',
      ].join('\n')
      await Bun.write(join(directory, name, 'pg_hba.conf'), hba)
      const container = `dbcli-pg-tls-${suffix}-${name.toLowerCase()}`
      // Track before starting so cleanup also covers a partially failed docker run.
      containers.push(container)
      await command([
        'docker',
        'run',
        '-d',
        '--rm',
        '--name',
        container,
        '-p',
        '127.0.0.1::5432',
        '-e',
        'POSTGRES_USER=dbcli_tls',
        '-e',
        `POSTGRES_PASSWORD=${password}`,
        '-e',
        'POSTGRES_DB=dbcli_tls',
        '-v',
        `${join(directory, name)}:/fixture:ro`,
        '--entrypoint',
        'sh',
        'postgres:16-alpine',
        '-c',
        'mkdir /tmp/tls && cp /fixture/* /tmp/tls/ && chown -R postgres:postgres /tmp/tls && chmod 600 /tmp/tls/* && exec docker-entrypoint.sh "$@"',
        'sh',
        'postgres',
        '-c',
        `ssl=${name === 'plaintext' ? 'off' : 'on'}`,
        ...(name === 'plaintext'
          ? []
          : ['-c', 'ssl_cert_file=/tmp/tls/server.crt', '-c', 'ssl_key_file=/tmp/tls/server.key']),
        '-c',
        'hba_file=/tmp/tls/pg_hba.conf',
        '-c',
        'log_connections=on',
        '-c',
        'log_disconnections=on',
        '-c',
        'log_statement=all',
        '-c',
        'log_line_prefix=%m [%p] ',
      ])
      const published = await command(['docker', 'port', container, '5432/tcp'])
      const port = Number(published.split(':').at(-1))
      if (!Number.isInteger(port) || port <= 0)
        throw new Error(`Invalid published port for ${name}`)
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
    const observe = async (name: PostgresTlsEndpointName) => {
      const endpoint = endpoints[name]
      // A fresh process avoids suite-global driver mocks and ambient PG/TLS settings.
      // These controls prove encryption/availability, never certificate authenticity.
      const output = await command(
        [
          process.execPath,
          '--no-env-file',
          '-e',
          `
          import { Client } from 'pg';
          const c = new Client({host:'127.0.0.1',port:Number(process.env.FIXTURE_PORT),
            user:'dbcli_tls',password:process.env.FIXTURE_PASSWORD,database:'dbcli_tls',
            connectionTimeoutMillis:2000,ssl:process.env.FIXTURE_TLS==='yes'?{rejectUnauthorized:false}:false});
          try { await c.connect(); const r=await c.query('SELECT ssl AS encrypted FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
            console.log(JSON.stringify(r.rows[0])); } finally { await c.end(); }
        `,
        ],
        ROOT,
        {
          PATH: process.env.PATH ?? '',
          FIXTURE_PORT: String(endpoint.port),
          FIXTURE_PASSWORD: password,
          FIXTURE_TLS: name === 'plaintext' ? 'no' : 'yes',
        }
      )
      const result: { encrypted: boolean } = JSON.parse(output)
      if (result.encrypted !== (name !== 'plaintext'))
        throw new Error(`Unexpected encryption state for ${name}`)
      return result
    }
    for (const name of NAMES) {
      const deadline = Date.now() + 60_000
      let healthy = false
      let lastFailure: unknown
      while (Date.now() < deadline) {
        try {
          await observe(name)
          healthy = true
          break
        } catch (error) {
          lastFailure = error
          await Bun.sleep(250)
        }
      }
      if (!healthy)
        throw new Error(
          `TLS fixture ${name} never became healthy: ${String(lastFailure)}\n${await command(['docker', 'logs', endpoints[name].container])}`
        )
      await command([
        'docker',
        'exec',
        endpoints[name].container,
        'psql',
        '-U',
        'dbcli_tls',
        '-d',
        'dbcli_tls',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "CREATE TABLE public.tls_fixture (id integer PRIMARY KEY, label text NOT NULL); INSERT INTO public.tls_fixture VALUES (1, 'verified TLS fixture');",
      ])
    }
    // Docker splits server output across stdout/stderr; collect both without trimming
    // so checkpoints retain exact append-only byte offsets within this short-lived suite.
    // TCP health succeeds only after initialization stdout is finished; PostgreSQL's
    // steady-state log output then appends exclusively to stderr.
    const logs = async (name: PostgresTlsEndpointName) => {
      const child = Bun.spawn(['docker', 'logs', endpoints[name].container], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (code !== 0) throw new Error(`Cannot read ${name} fixture logs`)
      return stdout + stderr
    }
    return {
      caPath: join(directory, 'ca.crt'),
      otherCaPath: join(directory, 'other-ca.crt'),
      endpoints,
      observe,
      logs,
      logCheckpoint: async (name) => (await logs(name)).length,
      logsSince: async (name, checkpoint) => (await logs(name)).slice(checkpoint),
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

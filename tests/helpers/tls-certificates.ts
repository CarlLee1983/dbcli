import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

async function command(args: string[], cwd: string) {
  const child = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(`Fixture ${args[0]} ${args[1]} failed (${code}): ${stderr}`)
  return stdout.trim()
}

export async function createTlsCertificates(directory: string, names: string[]) {
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
  for (const name of names.filter((name) => name !== 'plaintext')) {
    await mkdir(join(directory, name))
    const sans =
      name === 'wrongHost'
        ? 'DNS:wrong.invalid'
        : name === 'ipOnly'
          ? 'IP:127.0.0.1'
          : name === 'dnsOnly'
            ? 'DNS:localhost'
            : 'DNS:localhost,IP:127.0.0.1'
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
      '/CN=Disposable SQL fixture'
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
        String(names.indexOf(name) + 1),
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

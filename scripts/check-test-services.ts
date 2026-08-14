/**
 * Preflight: every service in docker-compose.test.yml is actually listening.
 *
 * The integration suite auto-skips what it cannot reach, which is right on a
 * developer machine and useless as a signal in CI: a job that starts no
 * services and one that starts all of them both report green. This runs first
 * and fails with the address, so "the services were up" is checked rather than
 * assumed.
 *
 * Ports come from the compose file rather than a list kept here, because a list
 * kept here is a list that drifts: adding a service to the compose file without
 * touching this script must still be covered. Parsing is deliberately narrow —
 * `ports:` entries of the form `- 'HOST:CONTAINER'` under a service key, which
 * is the only form that file uses — and it fails loudly if it finds no service
 * at all rather than passing an empty check.
 */

const COMPOSE = new URL('../docker-compose.test.yml', import.meta.url)

export interface PublishedPort {
  service: string
  port: number
}

/**
 * Read `service -> published host port` out of a compose file.
 *
 * Indentation carries the meaning here: two spaces starts a service, and the
 * quoted `HOST:CONTAINER` lines that follow belong to the service above them.
 */
export function parsePublishedPorts(source: string): PublishedPort[] {
  const found: PublishedPort[] = []
  let service: string | null = null

  for (const line of source.split('\n')) {
    const serviceMatch = line.match(/^ {2}([a-z0-9_-]+):\s*$/i)
    if (serviceMatch?.[1]) {
      service = serviceMatch[1]
      continue
    }

    const portMatch = line.match(/^\s*-\s*['"](\d+):\d+['"]\s*$/)
    if (portMatch?.[1] && service) {
      found.push({ service, port: Number(portMatch[1]) })
    }
  }

  return found
}

/** True when something accepts a TCP connection on the port. */
export async function isListening(host: string, port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: host,
      port,
      socket: {
        data() {},
        open(socket) {
          socket.end()
        },
        error() {},
        connectError() {},
      },
    })
    socket.end()
    return true
  } catch {
    return false
  }
}

if (import.meta.main) {
  const host = process.env.INTEGRATION_SERVICES_HOST ?? 'localhost'
  const services = parsePublishedPorts(await Bun.file(COMPOSE).text())

  if (services.length === 0) {
    console.error(
      'check-test-services: no published ports found in docker-compose.test.yml. ' +
        'Either the file changed shape or this parser is wrong; both mean the check is not checking.'
    )
    process.exit(1)
  }

  const down: PublishedPort[] = []
  for (const service of services) {
    if (!(await isListening(host, service.port))) down.push(service)
  }

  if (down.length > 0) {
    console.error(
      `test services unreachable on ${host}:\n` +
        down.map(({ service, port }) => `- ${service} (port ${port})`).join('\n') +
        '\n\nStart them with: docker compose -f docker-compose.test.yml up -d --wait'
    )
    process.exit(1)
  }

  console.log(
    `test services reachable: ${services.map(({ service, port }) => `${service}:${port}`).join(', ')}`
  )
}

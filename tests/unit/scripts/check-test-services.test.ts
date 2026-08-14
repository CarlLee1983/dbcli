/**
 * The preflight reads its port list from the compose file it is guarding.
 *
 * A hardcoded list would pass while a newly added service went unchecked —
 * which is the failure this whole preflight exists to prevent, one level up.
 */

import { describe, test, expect } from 'bun:test'
import { parsePublishedPorts } from '../../../scripts/check-test-services'

const COMPOSE = new URL('../../../docker-compose.test.yml', import.meta.url)

describe('parsePublishedPorts', () => {
  test('pairs each published host port with the service above it', () => {
    const source = [
      'services:',
      '  mysql:',
      '    image: mysql:8.4',
      '    ports:',
      "      - '3307:3306'",
      '  redis:',
      '    ports:',
      "      - '6379:6379'",
    ].join('\n')

    expect(parsePublishedPorts(source)).toEqual([
      { service: 'mysql', port: 3307 },
      { service: 'redis', port: 6379 },
    ])
  })

  test('ignores a container port that is not published', () => {
    // `expose:` and a bare container port are not reachable from the host, so
    // asserting on them would fail a correctly running stack.
    const source = ['services:', '  redis:', '    expose:', '      - 6379'].join('\n')

    expect(parsePublishedPorts(source)).toEqual([])
  })

  test('every service in the real compose file is covered', async () => {
    const parsed = parsePublishedPorts(await Bun.file(COMPOSE).text())
    const services = parsed.map((entry) => entry.service).sort()

    // Named explicitly: adding a service to the compose file without a
    // published port would otherwise leave it silently unguarded.
    expect(services).toEqual(['elasticsearch', 'mongodb', 'mysql', 'postgres', 'redis'])
    expect(parsed.every((entry) => Number.isInteger(entry.port) && entry.port > 0)).toBe(true)
  })
})

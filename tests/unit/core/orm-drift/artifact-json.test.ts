import { describe, expect, test } from 'bun:test'
import {
  parseDrizzleSnapshotJson,
  parseNormalizedJsonArtifact,
} from '@/core/orm-drift/artifact-json'

function thrownBy(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the artifact parser to throw')
}

describe('parseDrizzleSnapshotJson', () => {
  test('returns the decoded snapshot untouched when it is valid JSON', () => {
    expect(parseDrizzleSnapshotJson('drizzle/meta/0001_snapshot.json', '{"version":"7"}')).toEqual({
      version: '7',
    })
  })

  test('names the file and the regeneration route when it is not JSON', () => {
    const error = thrownBy(() =>
      parseDrizzleSnapshotJson('drizzle/meta/0001_snapshot.json', '{ "version": 7,')
    )

    expect(error.message).toContain('Malformed Drizzle snapshot')
    expect(error.message).toContain('drizzle/meta/0001_snapshot.json')
    expect(error.message).toContain('drizzle-kit generate')
    expect(error.message).toContain('is not valid JSON')
  })
})

describe('parseNormalizedJsonArtifact', () => {
  const valid = JSON.stringify({
    source: 'ddl',
    tables: [
      {
        identity: { table: 'users' },
        columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
        indexes: [],
        foreignKeys: [],
      },
    ],
    unparsed: [],
  })

  test('parses a valid artifact and forces the json source tag', () => {
    const schema = parseNormalizedJsonArtifact('schema.normalized.json', valid)

    expect(schema.source).toBe('json')
    expect(schema.tables).toHaveLength(1)
  })

  test('names the file instead of leaking parser noise', () => {
    const error = thrownBy(() => parseNormalizedJsonArtifact('schema.json', '{ "tables": ['))

    expect(error.message).toContain('Malformed normalized JSON schema')
    expect(error.message).toContain('schema.json')
    expect(error.message).toContain('is not valid JSON')
  })

  test('an unparsable snapshot reaching here by path still gets the Drizzle route', () => {
    // detectOrmFormat can only recognize Drizzle by decoding the file, so a broken
    // snapshot falls through to the `.json` extension rule and lands in this parser.
    const error = thrownBy(() =>
      parseNormalizedJsonArtifact('drizzle/meta/0007_snapshot.json', 'not json')
    )

    expect(error.message).toContain('Malformed Drizzle snapshot')
    expect(error.message).toContain('drizzle-kit generate')
  })

  test('reports contract violations by field rather than as a Zod dump', () => {
    const error = thrownBy(() =>
      parseNormalizedJsonArtifact('contract.json', JSON.stringify({ source: 'json', tables: 'no' }))
    )

    expect(error.message).toContain('Malformed normalized JSON schema')
    expect(error.message).toContain('contract.json')
    expect(error.message).toContain('  - tables: ')
    expect(error.message).toContain('  - unparsed: ')
    expect(error.message).not.toContain('"code"')
  })

  test('bounds the reported violations and counts the remainder', () => {
    const columns = Array.from({ length: 12 }, (_, index) => ({ name: `c${index}` }))
    const error = thrownBy(() =>
      parseNormalizedJsonArtifact(
        'many-issues.json',
        JSON.stringify({
          source: 'json',
          tables: [{ identity: { table: 'users' }, columns, indexes: [], foreignKeys: [] }],
          unparsed: [],
        })
      )
    )

    const reported = error.message.split('\n').filter((line) => line.startsWith('  - '))
    expect(reported).toHaveLength(5)
    expect(error.message).toMatch(/\.\.\. and \d+ more issues\./)
  })
})

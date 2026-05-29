// tests/unit/core/result-snapshot/serializer.test.ts
import { describe, it, expect } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSnapshot, readSnapshot } from '@/core/result-snapshot/serializer'
import { SnapshotVersionError, type ResultSnapshot } from '@/core/result-snapshot/types'

const sample: ResultSnapshot = {
  schemaVersion: 1,
  query: 'SELECT 1',
  engine: 'postgresql',
  createdAt: '2026-05-29T00:00:00.000Z',
  rowCount: 1,
  resultChecksum: 'abc',
  columns: [],
}

describe('snapshot serializer', () => {
  it('round-trips a snapshot through disk', async () => {
    const path = join(tmpdir(), `dbcli-snap-${process.pid}.json`)
    await writeSnapshot(path, sample)
    expect(await readSnapshot(path)).toEqual(sample)
  })

  it('throws SnapshotVersionError on unknown schemaVersion', async () => {
    const path = join(tmpdir(), `dbcli-snap-bad-${process.pid}.json`)
    await Bun.write(path, JSON.stringify({ ...sample, schemaVersion: 99 }))
    await expect(readSnapshot(path)).rejects.toBeInstanceOf(SnapshotVersionError)
  })
})

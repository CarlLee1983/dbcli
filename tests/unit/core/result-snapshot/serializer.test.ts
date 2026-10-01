// tests/unit/core/result-snapshot/serializer.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { rm } from 'node:fs/promises'
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

const snapshotFiles: string[] = []

afterEach(async () => {
  await Promise.all(snapshotFiles.splice(0).map((file) => rm(file, { force: true })))
})

describe('snapshot serializer', () => {
  it('round-trips a snapshot through disk', async () => {
    const path = join(tmpdir(), `dbcli-snap-${process.pid}.json`)
    snapshotFiles.push(path)
    await writeSnapshot(path, sample)
    expect(await readSnapshot(path)).toEqual(sample)
  })

  it('throws SnapshotVersionError on unknown schemaVersion', async () => {
    const path = join(tmpdir(), `dbcli-snap-bad-${process.pid}.json`)
    snapshotFiles.push(path)
    await Bun.write(path, JSON.stringify({ ...sample, schemaVersion: 99 }))
    await expect(readSnapshot(path)).rejects.toBeInstanceOf(SnapshotVersionError)
  })
})

// src/core/result-snapshot/serializer.ts
import { SnapshotVersionError, type ResultSnapshot } from './types'

export async function writeSnapshot(path: string, snap: ResultSnapshot): Promise<void> {
  await Bun.write(path, JSON.stringify(snap, null, 2))
}

export async function readSnapshot(path: string): Promise<ResultSnapshot> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    const err = new Error(`Snapshot file not found: ${path}`) as Error & { code?: string }
    err.code = 'SNAPSHOT_NOT_FOUND'
    throw err
  }
  const parsed = JSON.parse(await file.text()) as ResultSnapshot
  if (parsed.schemaVersion !== 1) {
    throw new SnapshotVersionError(
      `Unsupported snapshot schemaVersion ${parsed.schemaVersion} (expected 1)`
    )
  }
  return parsed
}

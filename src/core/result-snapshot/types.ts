// src/core/result-snapshot/types.ts
export type SnapshotEngine = 'postgresql' | 'mysql' | 'mariadb'

export interface ColumnFingerprint {
  name: string
  type: string
  nullCount: number
  distinctCount: number
  min?: number | string
  max?: number | string
  sum?: number
  checksum: string
  redacted?: true
}

export interface ResultSnapshot {
  schemaVersion: 1
  query: string
  engine: SnapshotEngine
  createdAt: string
  rowCount: number
  resultChecksum: string
  columns: ColumnFingerprint[]
  rows?: Array<Record<string, unknown>>
}

export interface AssertCheck {
  name: string
  expected: string
  actual: string
  pass: boolean
}

export interface AssertVerdict {
  pass: boolean
  checks: AssertCheck[]
}

export class SnapshotVersionError extends Error {
  code = 'SNAPSHOT_VERSION_MISMATCH'
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotVersionError'
  }
}

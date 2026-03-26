export interface NullCheckResult {
  column: string
  nullCount: number
  nullPercent: number
}

export interface OrphanCheckResult {
  column: string
  references: string
  orphanCount: number
}

export interface DuplicateCheckResult {
  columns: string[]
  indexName: string
  duplicateCount: number
}

export interface EmptyStringCheckResult {
  column: string
  count: number
}

export interface CheckReport {
  table: string
  rowCount: number
  sizeCategory: string
  checks: {
    nulls: NullCheckResult[]
    orphans: OrphanCheckResult[]
    duplicates: DuplicateCheckResult[]
    emptyStrings: EmptyStringCheckResult[]
  }
  summary: {
    issues: number
    warnings: number
    clean: number
  }
  skippedColumns?: string[]
}

export type CheckType = 'nulls' | 'duplicates' | 'orphans' | 'emptyStrings' | 'rowCount' | 'size'

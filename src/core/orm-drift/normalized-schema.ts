import { z } from 'zod'

export type OrmSource = 'db' | 'prisma' | 'ddl' | 'json' | 'drizzle' | 'typeorm' | 'sequelize'

export interface NormalizedColumn {
  name: string
  type: string
  rawType?: string
  nullable: boolean
  default?: string
  primaryKey?: boolean
}

export interface NormalizedIndex {
  name?: string
  columns: string[]
  unique: boolean
}

export interface NormalizedForeignKey {
  columns: string[]
  refTable: string
  refColumns: string[]
}

export interface NormalizedTable {
  name: string
  columns: NormalizedColumn[]
  indexes: NormalizedIndex[]
  foreignKeys: NormalizedForeignKey[]
}

export interface UnparsedEntry {
  location: string
  reason: string
}

export interface NormalizedSchema {
  source: OrmSource
  tables: Record<string, NormalizedTable>
  unparsed: UnparsedEntry[]
}

const columnZod = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  rawType: z.string().optional(),
  nullable: z.boolean(),
  default: z.string().optional(),
  primaryKey: z.boolean().optional(),
})

const tableZod = z.object({
  name: z.string().min(1),
  columns: z.array(columnZod),
  indexes: z.array(
    z.object({ name: z.string().optional(), columns: z.array(z.string()), unique: z.boolean() }),
  ),
  foreignKeys: z.array(
    z.object({ columns: z.array(z.string()), refTable: z.string(), refColumns: z.array(z.string()) }),
  ),
})

export const normalizedSchemaZod = z.object({
  source: z.enum(['db', 'prisma', 'ddl', 'json', 'drizzle', 'typeorm', 'sequelize']),
  tables: z.record(tableZod),
  unparsed: z.array(z.object({ location: z.string(), reason: z.string() })),
}) satisfies z.ZodType<NormalizedSchema>

export type TypeFamily =
  | 'integer'
  | 'decimal'
  | 'text'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'json'
  | 'binary'
  | 'uuid'
  | 'other'

const FAMILY_PATTERNS: Array<[TypeFamily, RegExp]> = [
  ['boolean', /^bool|^tinyint\(1\)/i],
  ['uuid', /^uuid/i],
  ['integer', /int|serial/i],
  ['decimal', /decimal|numeric|float|double|real|money/i],
  ['text', /char|text|citext|string/i],
  ['datetime', /timestamp|datetime/i],
  ['date', /^date$|^time/i],
  ['json', /json/i],
  ['binary', /bytea|blob|binary/i],
]

export function typeFamily(type: string): TypeFamily {
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(type)) return family
  }
  return 'other'
}

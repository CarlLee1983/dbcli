/**
 * Reading an ORM schema artifact off disk into the normalized comparison shape.
 *
 * This code was written inside `src/commands/diff.ts` and its own comment said
 * what it is: it never opens a database connection and never reads dbcli
 * configuration. `diff` is where it was first needed, not where it belongs.
 *
 * Living in a command module had a cost that only showed up when DBCLI-PLAT-011
 * came to describe `impact assess` and `design` in the capability catalog. Both
 * import these helpers, so both dragged `diff`'s adapter imports into their
 * static graph, and the contract test — which proves a `requiresConnection:
 * false` claim by checking that the command's graph loads no adapter — refused
 * the claim. The commands are offline; the import was not. Moving the helpers
 * to the core module they already depend on makes the claim provable instead of
 * exempted.
 *
 * `src/commands/diff.ts` re-exports these so its own callers and tests are
 * unaffected.
 */

import { resolve } from 'node:path'
import type { SqlDatabaseSystem } from '@/adapters/types'
import { detectOrmFormat, type OrmFormat } from '@/core/orm-drift/adapters/detect'
import { parseDdl, parseDdlFiles } from '@/core/orm-drift/adapters/ddl'
import { parseDrizzleSnapshot } from '@/core/orm-drift/adapters/drizzle'
import { parsePrismaSchema } from '@/core/orm-drift/adapters/prisma'
import {
  parseDrizzleSnapshotJson,
  parseNormalizedJsonArtifact,
} from '@/core/orm-drift/artifact-json'
import {
  normalizedSchemaZod,
  type NormalizedSchema,
  type OrmSource,
} from '@/core/orm-drift/normalized-schema'
import { validateFormat } from '@/utils/validation'

export const ORM_FORMATS = ['prisma', 'ddl', 'json', 'drizzle', 'typeorm', 'sequelize'] as const

export const ORM_ALIASES = {
  typeorm: { defaultIgnore: ['typeorm_metadata', 'migrations'] },
  sequelize: { defaultIgnore: ['SequelizeMeta'] },
} as const satisfies Record<string, { defaultIgnore: readonly string[] }>

export type OrmAlias = keyof typeof ORM_ALIASES
export type DriftOrmFormat = OrmFormat | OrmAlias

export function isDdlFormat(format: DriftOrmFormat): boolean {
  return format === 'ddl' || format in ORM_ALIASES
}

export interface LoadOrmSchemaOptions {
  ormFormat?: string
  system: SqlDatabaseSystem
}

export interface LoadedOrmSchema {
  schema: NormalizedSchema
  extraDefaultIgnore?: string[]
}

export function parseAgainstOrmValues(values: string[] | string): string[] {
  const rawValues = Array.isArray(values) ? values : [values]
  const paths = rawValues
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  const uniquePaths = [...new Set(paths)]
  if (uniquePaths.length === 0) {
    throw new Error('At least one ORM schema input is required')
  }
  return uniquePaths
}

function hasGlobMagic(path: string): boolean {
  return /[*?[\]{}!]/.test(path)
}

export async function expandOrmPaths(inputs: string[] | string): Promise<string[]> {
  const paths = parseAgainstOrmValues(inputs)
  const expanded = new Set<string>()

  for (const path of paths) {
    if (!hasGlobMagic(path)) {
      expanded.add(resolve(path))
      continue
    }

    const matches = await Array.fromAsync(
      new Bun.Glob(path).scan({
        cwd: process.cwd(),
        absolute: true,
        onlyFiles: true,
      })
    )
    if (matches.length === 0) {
      throw new Error(`ORM schema glob matched no files: ${path}`)
    }
    for (const match of matches) expanded.add(resolve(match))
  }

  return [...expanded].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export function parseOrmFormat(value: string | undefined): DriftOrmFormat | undefined {
  if (value === undefined) return undefined
  validateFormat(value, ORM_FORMATS, 'diff --orm-format')
  return value as DriftOrmFormat
}

function mergeNormalizedSchemas(schemas: NormalizedSchema[]): NormalizedSchema {
  const first = schemas[0]
  if (!first) throw new Error('At least one ORM schema input is required')

  return normalizedSchemaZod.parse({
    source: first.source,
    ...(first.defaultSchema !== undefined && { defaultSchema: first.defaultSchema }),
    tables: schemas.flatMap((schema) => schema.tables),
    unparsed: schemas.flatMap((schema) => schema.unparsed),
  })
}

/**
 * Parse an explicit local ORM artifact into the normalized comparison shape.
 * This never opens a database connection or reads dbcli configuration.
 */
export async function loadOrmSchema(
  paths: string[] | string,
  options: LoadOrmSchemaOptions
): Promise<LoadedOrmSchema> {
  const ormFormat = parseOrmFormat(options.ormFormat)
  const includesGlob = parseAgainstOrmValues(paths).some(hasGlobMagic)
  const expandedPaths = await expandOrmPaths(paths)
  const inputs: Array<{ path: string; content: string; format: DriftOrmFormat }> = []

  for (const path of expandedPaths) {
    if (/\.(?:ts|js|mjs|cjs)$/i.test(path)) {
      if (ormFormat === 'typeorm') {
        throw new Error(
          "TypeORM entities are not parsed directly. Generate DDL first: 'typeorm schema:log -d <datasource>' > schema.sql, then pass schema.sql."
        )
      }
      if (ormFormat === 'sequelize') {
        throw new Error(
          "Sequelize models are not parsed directly. Configure a scratch DB, then run 'sequelize db:migrate' against it. Dump DDL with 'pg_dump --schema-only <scratch-db> > schema.sql' or 'mysqldump --no-data <scratch-db> > schema.sql', then pass schema.sql to dbcli."
        )
      }
      throw new Error(
        "Drizzle/TypeORM TypeScript sources are not parsed directly. Run 'drizzle-kit generate' and pass drizzle/meta/<NNNN>_snapshot.json (or export DDL) instead."
      )
    }
    const file = Bun.file(path)
    if (!(await file.exists())) throw new Error(`ORM schema file not found: ${path}`)
    const content = await file.text()
    inputs.push({
      path,
      content,
      format: ormFormat ?? detectOrmFormat(path, content),
    })
  }

  if (inputs.length > 1 && inputs.some((input) => !isDdlFormat(input.format))) {
    throw new Error('Multiple ORM schema files are supported only for DDL inputs')
  }
  if (includesGlob && inputs.some((input) => !isDdlFormat(input.format))) {
    throw new Error('Glob ORM schema inputs are supported only for DDL')
  }

  const merged = inputs.every((input) => isDdlFormat(input.format))
    ? parseDdlFiles(
        inputs.map((input) => input.content),
        options.system
      )
    : mergeNormalizedSchemas(
        inputs.map(({ path, content, format }) => {
          if (format === 'prisma') return parsePrismaSchema(content)
          if (format === 'ddl' || format in ORM_ALIASES) return parseDdl(content, options.system)
          if (format === 'drizzle')
            return parseDrizzleSnapshot(parseDrizzleSnapshotJson(path, content))
          if (format === 'json') return parseNormalizedJsonArtifact(path, content)
          throw new Error(`Unsupported ORM input format: ${String(format)}`)
        })
      )
  const alias = ormFormat && ormFormat in ORM_ALIASES ? (ormFormat as OrmAlias) : undefined

  return {
    schema: alias ? { ...merged, source: alias as OrmSource } : merged,
    ...(alias ? { extraDefaultIgnore: [...ORM_ALIASES[alias].defaultIgnore] } : {}),
  }
}

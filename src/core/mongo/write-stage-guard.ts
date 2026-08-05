import { permissionAtLeast } from '@/core/permission-guard'
import type { Permission } from '@/types'

/**
 * Aggregation stages that write to a collection. MongoDB only permits them at
 * the top level of a pipeline, and forbids them inside `$facet`, `$lookup`, and
 * `$unionWith` sub-pipelines — we still scan those so enforcement does not
 * depend on the server rejecting them.
 */
export const MONGO_WRITE_STAGES = ['$out', '$merge'] as const

const SUB_PIPELINE_HOLDERS = ['$facet', '$lookup', '$unionWith'] as const

/** Permission level required to run a pipeline that writes. */
export const MONGO_WRITE_STAGE_MIN_PERMISSION: Permission = 'data-admin'

function collect(pipeline: unknown, found: Set<string>): void {
  if (!Array.isArray(pipeline)) return
  for (const stage of pipeline) {
    if (stage === null || typeof stage !== 'object') continue
    const record = stage as Record<string, unknown>
    for (const name of MONGO_WRITE_STAGES) {
      if (Object.prototype.hasOwnProperty.call(record, name)) found.add(name)
    }
    for (const holder of SUB_PIPELINE_HOLDERS) {
      const value = record[holder]
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        collect(value, found)
        continue
      }
      if (typeof value !== 'object') continue
      // `$facet` maps names to pipelines; `$lookup` / `$unionWith` carry a
      // `pipeline` field.
      for (const nested of Object.values(value as Record<string, unknown>)) {
        collect(nested, found)
      }
    }
  }
}

/** Write stages present in an aggregation pipeline, in declaration order. */
export function findMongoWriteStages(pipeline: unknown): string[] {
  const found = new Set<string>()
  collect(pipeline, found)
  return MONGO_WRITE_STAGES.filter((name) => found.has(name))
}

/**
 * Reject a pipeline that writes when the caller is not permitted to write.
 *
 * `allowWithPermission: false` refuses write stages outright regardless of the
 * configured permission — used by paths that are read-only by contract, such as
 * multi-connection fan-out and saved snippets.
 */
export function assertNoMongoWriteStages(
  pipeline: unknown,
  permission: Permission,
  options: { allowWithPermission?: boolean; context?: string } = {}
): void {
  const stages = findMongoWriteStages(pipeline)
  if (stages.length === 0) return

  const listed = stages.join(' / ')
  const { allowWithPermission = true, context } = options

  if (!allowWithPermission) {
    throw new Error(
      `${context ?? 'This pipeline'} cannot contain ${listed}: the stage writes to a collection.`
    )
  }

  if (!permissionAtLeast(permission, MONGO_WRITE_STAGE_MIN_PERMISSION)) {
    throw new Error(
      `Aggregation stage ${listed} writes to a collection and requires ` +
        `${MONGO_WRITE_STAGE_MIN_PERMISSION} permission (current level: ${permission}).`
    )
  }
}

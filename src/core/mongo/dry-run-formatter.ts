/**
 * MongoDryRunFormatter — render mongo write operations as shell-flavored
 * preview strings used by `--dry-run`.
 *
 * Output mirrors the mongo adapter's actual call shape (`updateMany` /
 * `deleteMany`), so a human can audit what would be sent.
 */

const INDENT = 2

function pretty(value: unknown): string {
  return JSON.stringify(value, null, INDENT)
}

export function previewInsert(collection: string, doc: Record<string, unknown>): string {
  return `db.${collection}.insertOne(${pretty(doc)})`
}

export function previewUpdate(
  collection: string,
  filter: Record<string, unknown>,
  updateDoc: Record<string, unknown>
): string {
  return `db.${collection}.updateMany(${pretty(filter)}, ${pretty(updateDoc)})`
}

export function previewDelete(collection: string, filter: Record<string, unknown>): string {
  return `db.${collection}.deleteMany(${pretty(filter)})`
}

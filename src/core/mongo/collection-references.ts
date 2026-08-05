/**
 * Every collection a MongoDB pipeline reads or writes.
 *
 * `$lookup.from` and `$unionWith.coll` are the MongoDB spelling of the JOIN
 * that issue #23 is about: the command names one collection, and the pipeline
 * reaches another. A blacklist that only checks the named collection misses it.
 *
 * Traversal mirrors `write-stage-guard.ts`: sub-pipelines are walked even where
 * the server forbids the construct, so enforcement does not depend on the
 * server rejecting anything.
 */

/** A collection a pipeline reaches, and where its fields land in the result. */
export interface MongoCollectionScope {
  collection: string
  /** Field prefix the documents are embedded under, when they are embedded. */
  prefix?: string
}

/** Stage fields that name a collection. */
const COLLECTION_FIELDS = ['from', 'coll', 'into'] as const

const SUB_PIPELINE_HOLDERS = ['$facet', '$lookup', '$unionWith', '$graphLookup'] as const

/** Stages whose value is either a collection name or an object naming one. */
const COLLECTION_STAGES = ['$lookup', '$unionWith', '$graphLookup', '$out', '$merge'] as const

function recordTarget(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    if (value.length > 0) found.add(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  for (const field of COLLECTION_FIELDS) {
    const target = record[field]
    if (typeof target === 'string' && target.length > 0) found.add(target)
    // `$out: { db, coll }` and `$merge: { into: { db, coll } }`.
    else if (target !== null && typeof target === 'object') recordTarget(target, found)
  }
}

/** Join a parent embedding path with a child one. */
function joinPrefix(parent: string | undefined, child: string | undefined): string | undefined {
  if (!parent) return child
  if (!child) return parent
  return `${parent}.${child}`
}

function collect(
  pipeline: unknown,
  found: Set<string>,
  scopes: MongoCollectionScope[],
  parentPrefix?: string
): void {
  if (!Array.isArray(pipeline)) return
  for (const stage of pipeline) {
    if (stage === null || typeof stage !== 'object') continue
    const record = stage as Record<string, unknown>

    for (const name of COLLECTION_STAGES) {
      if (!Object.prototype.hasOwnProperty.call(record, name)) continue
      // Scopes are recorded per occurrence, not per distinct collection: the
      // same collection joined twice arrives under two different `as` names,
      // and masking only the first left the second unmasked.
      const stageTargets = new Set<string>()
      recordTarget(record[name], stageTargets)
      for (const collection of stageTargets) found.add(collection)
      // `$lookup` / `$graphLookup` embed the source documents under `as`, so
      // that collection's field rules apply at `<as>.<field>`, not at the top
      // level. `$unionWith` merges documents in place and needs no prefix.
      const value = record[name]
      const as =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)['as']
          : undefined
      const prefix = joinPrefix(parentPrefix, typeof as === 'string' && as ? as : undefined)
      for (const collection of stageTargets) {
        scopes.push({ collection, ...(prefix ? { prefix } : {}) })
      }
    }

    for (const holder of SUB_PIPELINE_HOLDERS) {
      const value = record[holder]
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        // A `$facet` branch nests its documents under the branch name; the
        // stage's own `as` nests them further. A prefix that ignores the
        // nesting points the rules at a path the documents never occupy.
        collect(value, found, scopes, parentPrefix)
        continue
      }
      if (typeof value !== 'object') continue
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const holderPrefix =
          holder === '$facet'
            ? joinPrefix(parentPrefix, key)
            : joinPrefix(
                parentPrefix,
                typeof (value as Record<string, unknown>)['as'] === 'string'
                  ? ((value as Record<string, unknown>)['as'] as string)
                  : undefined
              )
        collect(nested, found, scopes, holderPrefix)
      }
    }
  }
}

/**
 * Collections named inside an aggregation pipeline, deduplicated.
 * Does not include the collection the command was invoked on — the caller
 * already knows that one and passes both to the blacklist check.
 */
export function findMongoCollectionReferences(pipeline: unknown): string[] {
  const found = new Set<string>()
  collect(pipeline, found, [])
  return Array.from(found)
}

/**
 * The same collections, each with the field prefix its documents arrive under.
 *
 * A `$lookup … as: 'sec'` places `secrets` documents at `sec.*`, so a rule
 * written as `secrets: ['token']` has to be matched at `sec.token`.
 */
export function findMongoCollectionScopes(pipeline: unknown): MongoCollectionScope[] {
  const scopes: MongoCollectionScope[] = []
  collect(pipeline, new Set<string>(), scopes)
  return scopes
}

import type {
  NormalizedTableIdentity,
  ParsedIdentifierPart,
  ParsedTableIdentifier,
} from '@/core/orm-drift/normalized-schema'

function resolvePart(part: ParsedIdentifierPart): string {
  return part.quoted ? part.value : part.value.toLowerCase()
}

export function resolveTableIdentifier(
  parsed: ParsedTableIdentifier,
  defaultSchema?: string
): NormalizedTableIdentity {
  return {
    ...(parsed.schema
      ? { schema: resolvePart(parsed.schema) }
      : defaultSchema !== undefined
        ? { schema: defaultSchema }
        : {}),
    table: resolvePart(parsed.table),
  }
}

export function tableIdentityKey(identity: NormalizedTableIdentity): string {
  return JSON.stringify([identity.schema ?? null, identity.table])
}

export function qualifiedTableName(identity: NormalizedTableIdentity): string {
  return identity.schema === undefined ? identity.table : `${identity.schema}.${identity.table}`
}

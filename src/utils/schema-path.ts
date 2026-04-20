/**
 * Filesystem layout for layered schema cache under .dbcli.
 * V1 / unnamed: .dbcli/schemas/
 * V2 per connection: .dbcli/schemas/<connectionName>/
 */
import { join } from 'path'

export function resolveSchemaPath(dbcliPath: string, connectionName?: string): string {
  if (!connectionName) return join(dbcliPath, 'schemas')
  return join(dbcliPath, 'schemas', connectionName)
}

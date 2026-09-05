/**
 * Example requirements owned by external Skills, not by dbcli.
 * Each consumer uses discover/preflight from skill-author-consumer.ts.
 */
export const EXTERNAL_CONSUMERS = {
  crud: ['schema.read', 'query.read', 'data.insert', 'data.update', 'data.delete'],
  cqrs: ['schema.read', 'query.read'],
  dba: ['connection.diagnose', 'schema.scan', 'audit.show'],
} as const

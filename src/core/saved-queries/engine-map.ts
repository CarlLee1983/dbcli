import type { EngineTag } from './types'

/**
 * Map adapter `system` (postgresql / mysql / mariadb / mongodb / elasticsearch / redis)
 * to the snippet engine tag. mongodb is now a first-class engine tag — callers no
 * longer need to special-case it.
 */
export function mapSystemToEngine(system: string): EngineTag {
  if (system === 'postgresql') return 'postgres'
  if (system === 'mysql' || system === 'mariadb') return 'mysql'
  if (system === 'mongodb') return 'mongodb'
  if (system === 'elasticsearch') return 'elasticsearch'
  if (system === 'redis') return 'redis'
  throw new Error(`Unsupported connection system for snippets: ${system}`)
}

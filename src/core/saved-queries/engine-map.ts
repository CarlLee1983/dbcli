import type { EngineTag } from './types'

/**
 * Map adapter `system` (postgresql / mysql / mariadb / mongodb) to the
 * snippet engine tag. mongodb is returned as-is so callers can detect it
 * and short-circuit (saved queries currently only support postgres / mysql).
 */
export function mapSystemToEngine(system: string): EngineTag | 'mongodb' {
  if (system === 'postgresql') return 'postgres'
  if (system === 'mysql' || system === 'mariadb') return 'mysql'
  if (system === 'mongodb') return 'mongodb'
  throw new Error(`Unsupported connection system for snippets: ${system}`)
}

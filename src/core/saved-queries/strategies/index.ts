import type { EngineTag } from '../types'
import type { EngineFamily, EngineStrategy } from './types'

export * from './types'

export function engineFamily(engine: EngineTag): EngineFamily {
  if (engine === 'postgres' || engine === 'mysql') return 'sql'
  if (engine === 'elasticsearch') return 'es'
  if (engine === 'redis') return 'redis'
  throw new Error(`Unknown engine: ${engine}`)
}

// Strategies registered in later tasks via getStrategy(family).
export function getStrategy(_family: EngineFamily): EngineStrategy {
  throw new Error('getStrategy: no strategies registered yet')
}

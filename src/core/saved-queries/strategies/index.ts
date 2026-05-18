import { sqlStrategy } from './sql'
import { esStrategy } from './elasticsearch'
import { redisStrategy } from './redis'
import { mongoStrategy } from './mongodb'
import type { EngineTag } from '../types'
import type { EngineFamily, EngineStrategy } from './types'

export * from './types'

export function engineFamily(engine: EngineTag): EngineFamily {
  if (engine === 'postgres' || engine === 'mysql') return 'sql'
  if (engine === 'elasticsearch') return 'es'
  if (engine === 'redis') return 'redis'
  if (engine === 'mongodb') return 'mongo'
  throw new Error(`Unknown engine: ${engine}`)
}

export function getStrategy(family: EngineFamily): EngineStrategy {
  switch (family) {
    case 'sql':
      return sqlStrategy
    case 'es':
      return esStrategy
    case 'redis':
      return redisStrategy
    case 'mongo':
      return mongoStrategy
    default:
      throw new Error(`No strategy registered for family: ${family}`)
  }
}

import type { RedisWarning } from '@/adapters/types'
import { getCommandSpec } from './command-metadata'
import { REDIS_LIMIT_DEFAULT } from './types'

export interface RewriteResult {
  rewritten: string[]
  warning?: RedisWarning
}

export interface SizeGuardOptions {
  noLimit: boolean
}

export function rewriteArgs(
  command: string,
  args: string[],
  opts: SizeGuardOptions
): RewriteResult {
  if (opts.noLimit) return { rewritten: args }
  const spec = getCommandSpec(command)
  if (!spec) return { rewritten: args }

  const original = args
  switch (spec.sizeGuard.kind) {
    case 'rewrite-count':
      return rewriteCount(command, args, original)
    case 'rewrite-stop':
      return rewriteStop(command, args, spec.sizeGuard.argIndex, original)
    case 'rewrite-limit':
      return rewriteLimit(command, args, original)
    default:
      return { rewritten: args }
  }
}

function rewriteCount(command: string, args: string[], original: string[]): RewriteResult {
  const idx = args.findIndex((a) => a.toUpperCase() === 'COUNT')
  if (idx === -1) {
    const rewritten = [...args, 'COUNT', String(REDIS_LIMIT_DEFAULT)]
    return { rewritten, warning: { code: 'REDIS_SIZE_REWRITE', command, original, rewritten } }
  }
  const n = parseInt(args[idx + 1] ?? '0', 10)
  if (n > REDIS_LIMIT_DEFAULT) {
    const rewritten = [...args]
    rewritten[idx + 1] = String(REDIS_LIMIT_DEFAULT)
    return { rewritten, warning: { code: 'REDIS_SIZE_REWRITE', command, original, rewritten } }
  }
  return { rewritten: args }
}

function rewriteStop(
  command: string,
  args: string[],
  stopIdx: number,
  original: string[]
): RewriteResult {
  const startStr = args[stopIdx - 1] ?? '0'
  const stopStr = args[stopIdx]
  if (stopStr === undefined) return { rewritten: args }
  const start = parseInt(startStr, 10) || 0
  const stop = parseInt(stopStr, 10)
  const span = stop === -1 ? Infinity : stop - start + 1
  if (span > REDIS_LIMIT_DEFAULT) {
    const rewritten = [...args]
    rewritten[stopIdx] = String(start + REDIS_LIMIT_DEFAULT - 1)
    return { rewritten, warning: { code: 'REDIS_SIZE_REWRITE', command, original, rewritten } }
  }
  return { rewritten: args }
}

function rewriteLimit(command: string, args: string[], original: string[]): RewriteResult {
  const idx = args.findIndex((a) => a.toUpperCase() === 'LIMIT')
  if (idx === -1) {
    const rewritten = [...args, 'LIMIT', '0', String(REDIS_LIMIT_DEFAULT)]
    return { rewritten, warning: { code: 'REDIS_SIZE_REWRITE', command, original, rewritten } }
  }
  const n = parseInt(args[idx + 2] ?? '0', 10)
  if (n > REDIS_LIMIT_DEFAULT) {
    const rewritten = [...args]
    rewritten[idx + 2] = String(REDIS_LIMIT_DEFAULT)
    return { rewritten, warning: { code: 'REDIS_SIZE_REWRITE', command, original, rewritten } }
  }
  return { rewritten: args }
}

export interface TruncateResult<T = unknown> {
  value: T
  warning?: RedisWarning
}

export function truncateResult<T = unknown>(
  command: string,
  reply: T,
  opts: SizeGuardOptions
): TruncateResult<T> {
  if (opts.noLimit) return { value: reply }
  const spec = getCommandSpec(command)
  if (!spec || spec.sizeGuard.kind !== 'truncate') return { value: reply }

  if (Array.isArray(reply)) {
    if (reply.length > REDIS_LIMIT_DEFAULT) {
      const droppedAtLeast = reply.length - REDIS_LIMIT_DEFAULT
      const value = reply.slice(0, REDIS_LIMIT_DEFAULT) as unknown as T
      return {
        value,
        warning: {
          code: 'REDIS_SIZE_TRUNCATE',
          command,
          kept: REDIS_LIMIT_DEFAULT,
          droppedAtLeast,
        },
      }
    }
    return { value: reply }
  }

  if (reply && typeof reply === 'object') {
    const obj = reply as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length > REDIS_LIMIT_DEFAULT) {
      const dropped = keys.length - REDIS_LIMIT_DEFAULT
      const truncated: Record<string, unknown> = {}
      for (let i = 0; i < REDIS_LIMIT_DEFAULT; i++) truncated[keys[i]!] = obj[keys[i]!]
      return {
        value: truncated as unknown as T,
        warning: {
          code: 'REDIS_SIZE_TRUNCATE',
          command,
          kept: REDIS_LIMIT_DEFAULT,
          droppedAtLeast: dropped,
        },
      }
    }
  }
  return { value: reply }
}

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

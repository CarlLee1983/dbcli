import type { DatabaseAdapter } from '@/adapters/types'

/**
 * Race the adapter's getServerVersion() against a hard timeout so a slow DB
 * cannot block the entire snapshot. Returns null on timeout / error / unknown.
 */
export async function collectVersion(
  adapter: DatabaseAdapter,
  timeoutMs: number
): Promise<string | null> {
  const probe = adapter.getServerVersion().then(
    (v) => (typeof v === 'string' && v !== 'unknown' ? v : null),
    () => null
  )
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  return Promise.race([probe, timeout])
}

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@carllee1983/dbcli/latest'
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours
const FETCH_TIMEOUT_MS = 3000

export interface VersionCheckCache {
  latestVersion: string
  checkedAt: string // ISO date
}

export interface VersionCheckResult {
  hasUpdate: boolean
  latestVersion: string
}

/**
 * Compare two semver strings (ignoring pre-release suffix for numeric comparison).
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  // Strip pre-release suffixes (e.g. "-beta") for numeric comparison
  const stripSuffix = (v: string) => v.replace(/-.*$/, '')
  const pa = stripSuffix(a).split('.').map(Number)
  const pb = stripSuffix(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  // If numeric parts are equal, compare full string for pre-release ordering
  if (a === b) return 0
  // Version without pre-release suffix is "newer" than one with (1.0.0 > 1.0.0-beta)
  const aHasSuffix = a.includes('-')
  const bHasSuffix = b.includes('-')
  if (!aHasSuffix && bHasSuffix) return 1
  if (aHasSuffix && !bHasSuffix) return -1
  return a.localeCompare(b)
}

/**
 * Returns true if the given ISO date string is more than 24 hours old.
 */
export function isStale(checkedAt: string): boolean {
  const checked = new Date(checkedAt).getTime()
  if (isNaN(checked)) return true
  return Date.now() - checked >= STALE_THRESHOLD_MS
}

/**
 * Fetch the latest version from npm registry.
 * Returns null on any error (silent).
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { version: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/**
 * Check if an update is available.
 *
 * @param currentVersion - The currently installed version
 * @param cachePath - Path to write version-check.json cache (null to skip caching)
 * @param existingCache - Optionally pass in pre-loaded cache (avoids file I/O in tests)
 * @returns VersionCheckResult or null if check failed
 */
export async function checkForUpdate(
  currentVersion: string,
  cachePath: string | null,
  existingCache?: VersionCheckCache | null
): Promise<VersionCheckResult | null> {
  // Use provided cache or load from file
  let cache: VersionCheckCache | null = existingCache ?? null

  if (cache === undefined && cachePath) {
    try {
      const cacheFile = Bun.file(`${cachePath}/version-check.json`)
      if (await cacheFile.exists()) {
        cache = (await cacheFile.json()) as VersionCheckCache
      }
    } catch {
      cache = null
    }
  }

  // Use fresh cache if available
  if (cache && !isStale(cache.checkedAt)) {
    return {
      hasUpdate: compareVersions(cache.latestVersion, currentVersion) > 0,
      latestVersion: cache.latestVersion,
    }
  }

  // Fetch from registry
  const latestVersion = await fetchLatestVersion()
  if (!latestVersion) return null

  // Write cache to file
  if (cachePath) {
    try {
      const newCache: VersionCheckCache = {
        latestVersion,
        checkedAt: new Date().toISOString(),
      }
      await Bun.write(`${cachePath}/version-check.json`, JSON.stringify(newCache, null, 2))
    } catch {
      // Silently ignore cache write errors
    }
  }

  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    latestVersion,
  }
}

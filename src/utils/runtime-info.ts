import { join, normalize, relative, sep } from 'node:path'
import { findPackageRoot } from '@/utils/package-root'

export type RuntimeSource = 'workspace' | 'installed' | 'bunx' | 'unknown'

export interface RuntimeInfo {
  executablePath: string
  launcherPath: string
  packageRoot: string
  packageVersion: string
  packageFileVersion: string | null
  runtimeName: 'bun' | 'node' | 'other'
  runtimeVersion: string
  source: RuntimeSource
  versionMismatch: boolean
}

function normalized(path: string): string {
  return normalize(path).replaceAll('\\', '/')
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('/'))
}

export function inferRuntimeSource(launcherPath: string, packageRoot: string): RuntimeSource {
  const launcher = normalized(launcherPath)
  const root = normalized(packageRoot)

  if (
    launcher.includes('/.bunx/') ||
    launcher.includes('/bunx/') ||
    root.includes('/.bun/install/cache/')
  ) {
    return 'bunx'
  }
  if (isWithin(launcher, `${root}/src`) || isWithin(launcher, `${root}/scripts`)) {
    return 'workspace'
  }
  if (isWithin(launcher, `${root}/dist`)) return 'installed'
  return 'unknown'
}

/**
 * Collect the runtime identity that a diagnostic command should show. The
 * package version is passed by the caller because a bundled CLI has that
 * value inlined at build time; packageFileVersion lets doctor detect a stale
 * bundle being launched from a different package tree.
 */
export async function collectRuntimeInfo(packageVersion: string): Promise<RuntimeInfo> {
  const packageRoot = findPackageRoot()
  const launcherPath = process.argv[1] ?? 'unknown'
  let packageFileVersion: string | null = null

  try {
    const packageFile = Bun.file(join(packageRoot, 'package.json'))
    if (await packageFile.exists()) {
      const parsed = (await packageFile.json()) as { version?: unknown }
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        packageFileVersion = parsed.version
      }
    }
  } catch {
    // Diagnostics must remain available even when the package file is unreadable.
  }

  const versions = process.versions as Record<string, string | undefined>
  const runtimeName: RuntimeInfo['runtimeName'] = versions.bun
    ? 'bun'
    : versions.node
      ? 'node'
      : 'other'
  const runtimeVersion = versions[runtimeName] ?? 'unknown'

  return {
    executablePath: process.execPath,
    launcherPath,
    packageRoot,
    packageVersion,
    packageFileVersion,
    runtimeName,
    runtimeVersion,
    source: inferRuntimeSource(launcherPath, packageRoot),
    versionMismatch: packageFileVersion !== null && packageFileVersion !== packageVersion,
  }
}

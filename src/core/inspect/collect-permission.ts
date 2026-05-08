import type { Permission } from '@/types'
import type { PermissionSection } from './types'

export function collectPermission(level: Permission): PermissionSection {
  const canWrite = level === 'read-write' || level === 'data-admin' || level === 'admin'
  const canDestruct = level === 'data-admin' || level === 'admin'
  return { level, canWrite, canDestruct }
}

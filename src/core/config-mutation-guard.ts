import { ConfigError } from '@/utils/errors'

/**
 * Prevent an agent-mode process from changing connection identity, permission,
 * or credentials. Human/admin changes must run in a separate process with the
 * agent-mode boundary disabled; an environment variable supplied by the same
 * untrusted process is not an approval mechanism.
 *
 * This is intentionally opt-in for normal local CLI use: `DBCLI_AGENT_MODE=1`
 * marks an untrusted automation context. The host that launches an agent owns
 * that boundary; dbcli never accepts a same-process approval override.
 */
export function assertConfigMutationApproved(): void {
  if (process.env.DBCLI_AGENT_MODE !== '1') return

  throw new ConfigError(
    'Agent mode blocks configuration, permission, and credential changes. A human or administrator must run the approved workflow outside agent mode.'
  )
}

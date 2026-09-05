import {
  CAPABILITY_CONTRACT_SCHEMA_VERSION,
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  parseCapabilityCatalog,
  parseOperationEnvelope,
  type CapabilityCatalog,
  type OperationEnvelope,
} from '@carllee1983/dbcli/core'

export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type RunDbcli = (args: readonly string[]) => Promise<CommandResult>

export class DbcliIntegrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbcliIntegrationError'
  }
}

function json(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new DbcliIntegrationError(`${label} did not emit JSON`)
  }
}

/** Discover the static catalog and reject an unpinned or non-strict response. */
export async function discover(run: RunDbcli): Promise<CapabilityCatalog> {
  const result = await run(['capabilities', '--format', 'json'])
  if (result.code !== 0 || result.stderr !== '') {
    throw new DbcliIntegrationError(`capability discovery failed (exit ${result.code})`)
  }
  const catalog = parseCapabilityCatalog(json(result.stdout, 'capability discovery'))
  if (catalog.schemaVersion !== CAPABILITY_CONTRACT_SCHEMA_VERSION) {
    throw new DbcliIntegrationError(`unsupported capability schema ${catalog.schemaVersion}`)
  }
  return catalog
}

/**
 * Run requirement preflight through the agent envelope. Exit 1 is a valid
 * completed negative result; callers inspect `envelope.ok` and `error`.
 */
export async function preflight(
  run: RunDbcli,
  required: readonly string[],
  correlationId: string
): Promise<OperationEnvelope> {
  const result = await run([
    '--agent-output',
    '--correlation-id',
    correlationId,
    'capabilities',
    'check',
    '--require',
    required.join(','),
  ])
  if (![0, 1, 2].includes(result.code) || result.stderr !== '') {
    throw new DbcliIntegrationError(
      `capability preflight failed outside its contract (exit ${result.code})`
    )
  }
  const parsed = parseOperationEnvelope(json(result.stdout, 'capability preflight'))
  if (!parsed.ok) throw new DbcliIntegrationError(`invalid Operation Envelope: ${parsed.reason}`)
  if (parsed.value.schemaVersion !== OPERATION_ENVELOPE_SCHEMA_VERSION) {
    throw new DbcliIntegrationError(
      `unsupported Operation Envelope schema ${parsed.value.schemaVersion}`
    )
  }
  return parsed.value
}

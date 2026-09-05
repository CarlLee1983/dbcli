/**
 * `dbcli capabilities` — discovery, and only discovery.
 *
 * The catalog is static: this command answers from `src/core/capabilities`
 * without opening a connection, and `capabilities check` evaluates a
 * requirement list against the *local config* alone. Neither reaches a
 * database, and neither writes anything.
 *
 * Listing a capability is not a grant. `available` says the configured engine
 * and permission would not refuse the operation; the blacklist, the write gate,
 * the confirmation prompt and the audit log all still run at execution time,
 * and a human's approval is not modelled here at all.
 */

import { Command } from 'commander'
import { resolveCapabilityContext } from './capability-context'
import {
  buildCapabilityCatalog,
  checkCapabilities,
  parseRequirements,
  type Capability,
  type CapabilityCheckReport,
} from '@/core/capabilities'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { CAPABILITY_ID_PATTERN } from '@/core/capabilities/schema'
import {
  MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH,
  MAX_OPERATION_ENVELOPE_ITEMS,
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  type OperationEnvelope,
  type OperationEnvelopeWarning,
} from '@/core/operation-envelope'
import { emitAgentOutputEnvelope, emitAgentOutputFailure } from '@/utils/agent-output'
import { isCorrelationId } from '@/core/correlation-id'

const CATALOG_FORMATS = ['text', 'json', 'markdown'] as const
const CHECK_FORMATS = ['text', 'json'] as const

/** Invalid input or unreadable config. Distinct from "a requirement failed". */
const EXIT_INVALID_INPUT = 2
/** At least one requirement is unavailable or unknown. */
const EXIT_REQUIREMENTS_UNMET = 1

function renderCatalogText(capabilities: readonly Capability[], schemaVersion: number): string {
  const lines = [
    `dbcli capability contract v${schemaVersion} — ${capabilities.length} capabilities`,
    '',
    'Discovery only: a listed capability is not permission to run it.',
    '',
  ]
  for (const capability of capabilities) {
    lines.push(`${capability.id}  [${capability.risk}]`)
    lines.push(`  ${capability.description}`)
    lines.push(
      `  command: dbcli ${capability.command}    permission: ${capability.minimumPermission}` +
        `    connection: ${capability.requiresConnection ? 'required' : 'not required'}`
    )
    lines.push(
      `  engines: ${capability.engineIndependent ? 'any (engine-independent)' : capability.engines.join(', ')}`
    )
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function renderCatalogMarkdown(capabilities: readonly Capability[], schemaVersion: number): string {
  const lines = [
    `# dbcli capability contract v${schemaVersion}`,
    '',
    'A capability names an atomic dbcli ability. Composing capabilities into a job',
    'belongs to the Skill calling dbcli, not to dbcli. Listing a capability is',
    'discovery, not a permission grant.',
    '',
    '| id | risk | command | permission | connection | engines |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const capability of capabilities) {
    const engines = capability.engineIndependent ? 'any' : capability.engines.join(', ')
    lines.push(
      `| \`${capability.id}\` | ${capability.risk} | \`dbcli ${capability.command}\` | ` +
        `${capability.minimumPermission} | ${capability.requiresConnection ? 'required' : 'no'} | ${engines} |`
    )
  }
  lines.push('')
  for (const capability of capabilities) {
    lines.push(`- \`${capability.id}\` — ${capability.description}`)
  }
  return lines.join('\n')
}

function renderCheckText(report: CapabilityCheckReport): string {
  const lines: string[] = []
  if (report.context) {
    lines.push(
      `Context: engine ${report.context.engine}, permission ${report.context.permission}` +
        (report.context.connectionName ? `, connection ${report.context.connectionName}` : '') +
        (report.context.agentMode ? ', agent mode' : '')
    )
  } else {
    lines.push('Context: unavailable (see warnings below)')
  }
  lines.push('')
  for (const result of report.results) {
    lines.push(
      `${result.status.padEnd(11)} ${result.id}${result.reason ? `  (${result.reason})` : ''}`
    )
  }
  if (report.warnings.length > 0) {
    lines.push('')
    for (const warning of report.warnings) lines.push(`warning: ${warning}`)
  }
  lines.push('')
  lines.push(
    report.ok ? 'All required capabilities are available.' : 'Some requirements are not met.'
  )
  return lines.join('\n')
}

function agentOutputRequested(command: Command): boolean {
  return command.optsWithGlobals<Record<string, unknown>>().agentOutput === true
}

function correlationId(command: Command): string | undefined {
  const value = command.optsWithGlobals<Record<string, unknown>>().correlationId
  return isCorrelationId(value) ? value : undefined
}

function validAgentRequirements(ids: readonly string[], warnings: readonly string[]): boolean {
  return (
    ids.length <= MAX_OPERATION_ENVELOPE_ITEMS &&
    warnings.length <= MAX_OPERATION_ENVELOPE_ITEMS &&
    ids.every(
      (id) =>
        id.length <= MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH && CAPABILITY_ID_PATTERN.test(id)
    )
  )
}

function toAgentWarnings(warnings: readonly string[]): OperationEnvelopeWarning[] {
  return warnings.map((message) => {
    if (message.startsWith('Duplicate capability id ')) {
      return { code: 'DUPLICATE_CAPABILITY_REQUIREMENT', message }
    }
    if (message.startsWith('No dbcli configuration was found')) {
      return { code: 'CAPABILITY_CONTEXT_UNAVAILABLE', message }
    }
    if (message.startsWith('A dbcli configuration exists')) {
      return { code: 'CAPABILITY_CONTEXT_UNRESOLVABLE', message }
    }
    if (message.startsWith('Agent mode is active')) {
      return { code: 'AGENT_MODE_RESTRICTION_ACTIVE', message }
    }
    throw new Error('Unregistered capability warning')
  })
}

function toAgentEnvelope(
  report: CapabilityCheckReport,
  correlationId: string | undefined
): OperationEnvelope {
  const ok = report.ok
  return {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok,
    operation: 'capabilities.check',
    status: ok ? 'succeeded' : 'failed',
    context:
      report.context === null
        ? null
        : { ...report.context, ...(correlationId !== undefined && { correlationId }) },
    data: { required: report.required, results: report.results },
    warnings: toAgentWarnings(report.warnings),
    evidence: [],
    recovery: null,
    error: ok
      ? null
      : {
          code: 'CAPABILITY_REQUIREMENTS_UNMET',
          message: 'One or more required capabilities are unavailable.',
        },
  }
}

export const capabilitiesCommand = new Command('capabilities')
  .description('List the static dbcli capability catalog (no database connection)')
  // Both this command and `check` take `--format`. Without positional options
  // Commander binds `capabilities check --format json` to the parent, and the
  // subcommand silently runs with its default — a JSON consumer would receive
  // prose. See the same opt-in on the root program.
  .enablePositionalOptions()
  .option('--format <type>', 'Output format: text, json, markdown', 'text')
  .action((options: { format: string }, command: Command) => {
    const agentOutput = agentOutputRequested(command)
    try {
      validateFormat(options.format, CATALOG_FORMATS, 'capabilities')
      const catalog = buildCapabilityCatalog()

      if (agentOutput) {
        const envelope: OperationEnvelope = {
          schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
          ok: true,
          operation: 'capabilities.list',
          status: 'succeeded',
          context: null,
          data: catalog,
          warnings: [],
          evidence: [],
          recovery: null,
          error: null,
        }
        process.exit(emitAgentOutputEnvelope(envelope, 0))
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(catalog, null, 2))
      } else if (options.format === 'markdown') {
        console.log(renderCatalogMarkdown(catalog.capabilities, catalog.schemaVersion))
      } else {
        console.log(renderCatalogText(catalog.capabilities, catalog.schemaVersion))
      }
    } catch (error) {
      if (agentOutput) {
        process.exit(emitAgentOutputFailure('AGENT_OUTPUT_INTERNAL_ERROR', 1, 'capabilities.list'))
      }
      console.error(`Error: ${(error as Error).message}`)
      process.exit(EXIT_INVALID_INPUT)
    }
  })

capabilitiesCommand
  .command('check')
  .description('Check whether required capabilities are available here (no database connection)')
  .requiredOption('--require <ids>', 'Comma-separated capability ids, e.g. schema.read,query.read')
  .option('--format <type>', 'Output format: text, json', 'text')
  .action(async (options: { require: string; format: string }, command: Command) => {
    const agentOutput = agentOutputRequested(command)
    const commandCorrelationId = correlationId(command)
    let parsed
    try {
      validateFormat(options.format, CHECK_FORMATS, 'capabilities check')
      parsed = parseRequirements(options.require)
    } catch (error) {
      if (agentOutput) {
        process.exit(emitAgentOutputFailure('INVALID_CAPABILITY_REQUIREMENTS', 2))
      }
      console.error(`Error: ${(error as Error).message}`)
      // `process.exit` is typed `never`, which is the only reason `parsed` reads
      // as defined below. A stub or wrapper that does not terminate would throw
      // a TypeError after the error was already printed; the explicit return
      // costs nothing and removes the dependency on that typing.
      process.exit(EXIT_INVALID_INPUT)
      return
    }

    if (agentOutput && !validAgentRequirements(parsed.ids, parsed.warnings)) {
      process.exit(emitAgentOutputFailure('INVALID_CAPABILITY_REQUIREMENTS', 2))
    }

    const { context, failure } = await resolveCapabilityContext(resolveConfigPath(command))
    if (
      agentOutput &&
      context?.connectionName !== null &&
      context?.connectionName !== undefined &&
      context.connectionName.length > MAX_OPERATION_ENVELOPE_IDENTIFIER_LENGTH
    ) {
      process.exit(emitAgentOutputFailure('AGENT_OUTPUT_INTERNAL_ERROR', 1))
    }
    const report = checkCapabilities(parsed.ids, context, parsed.warnings, failure)

    if (agentOutput) {
      if (report.warnings.length > MAX_OPERATION_ENVELOPE_ITEMS) {
        process.exit(emitAgentOutputFailure('INVALID_CAPABILITY_REQUIREMENTS', 2))
      }
      process.exit(
        emitAgentOutputEnvelope(toAgentEnvelope(report, commandCorrelationId), report.ok ? 0 : 1)
      )
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(renderCheckText(report))
    }

    if (!report.ok) process.exit(EXIT_REQUIREMENTS_UNMET)
  })

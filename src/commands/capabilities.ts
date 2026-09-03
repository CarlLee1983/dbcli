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

import { join } from 'node:path'
import { Command } from 'commander'
import {
  buildCapabilityCatalog,
  checkCapabilities,
  parseRequirements,
  type Capability,
  type CapabilityCheckContext,
  type CapabilityCheckReport,
} from '@/core/capabilities'
import { configModule } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { DATABASE_SYSTEMS, type DatabaseSystem } from '@/adapters/types'

const CATALOG_FORMATS = ['text', 'json', 'markdown'] as const
const CHECK_FORMATS = ['text', 'json'] as const

/** Invalid input or unreadable config. Distinct from "a requirement failed". */
const EXIT_INVALID_INPUT = 2
/** At least one requirement is unavailable or unknown. */
const EXIT_REQUIREMENTS_UNMET = 1

function isDatabaseSystem(value: unknown): value is DatabaseSystem {
  return typeof value === 'string' && (DATABASE_SYSTEMS as readonly string[]).includes(value)
}

/**
 * Read engine and permission from the local config, or `null` when there is
 * none to read.
 *
 * `loadLayeredSchema: false` keeps this off the schema cache: a capability
 * check has no use for table structure, and loading it would make a discovery
 * command's cost depend on the size of the database it is describing. Only
 * `permission` and `connection.system` are read; nothing else from the config
 * reaches the output.
 */
async function configExists(configPath: string): Promise<boolean> {
  const storagePath = await resolveConfigStoragePath(configPath)
  if (await Bun.file(join(storagePath, 'config.json')).exists()) return true
  return Bun.file(configPath).exists()
}

async function resolveContext(command: Command): Promise<CapabilityCheckContext | null> {
  try {
    const configPath = resolveConfigPath(command)

    // `configModule.read` answers a missing config with DEFAULT_CONFIG — a
    // localhost PostgreSQL at query-only — so that `init` has something to
    // start from. Reporting engine and permission from those defaults would
    // have this command state, in JSON, that a database nobody configured
    // supports the requested capability. Existence is therefore established
    // first, against the same storage path the reader itself resolves.
    if (!(await configExists(configPath))) return null

    const config = await configModule.read(configPath, undefined, {
      loadLayeredSchema: false,
    })
    const system = config.connection?.system
    if (!isDatabaseSystem(system)) return null

    return {
      engine: system,
      permission: config.permission,
      // The connection the reader actually resolved, not the one `--use` asked
      // for. On a v2 config with no selector those differ: the default named
      // connection is in effect and `--use` is unset, and reporting `null`
      // there would leave the verdict unattributable to the connection that
      // produced it.
      connectionName: config.effectiveConnectionName ?? null,
    }
  } catch {
    // A missing, unreadable or invalid config is context-unavailable, not an
    // error: the caller asked what dbcli could do here, and "nothing is
    // configured here" is the honest answer. It never reads as available.
    return null
  }
}

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
        (report.context.connectionName ? `, connection ${report.context.connectionName}` : '')
    )
  } else {
    lines.push('Context: unavailable (no readable dbcli configuration)')
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

export const capabilitiesCommand = new Command('capabilities')
  .description('List the static dbcli capability catalog (no database connection)')
  // Both this command and `check` take `--format`. Without positional options
  // Commander binds `capabilities check --format json` to the parent, and the
  // subcommand silently runs with its default — a JSON consumer would receive
  // prose. See the same opt-in on the root program.
  .enablePositionalOptions()
  .option('--format <type>', 'Output format: text, json, markdown', 'text')
  .action((options: { format: string }) => {
    try {
      validateFormat(options.format, CATALOG_FORMATS, 'capabilities')
      const catalog = buildCapabilityCatalog()

      if (options.format === 'json') {
        console.log(JSON.stringify(catalog, null, 2))
      } else if (options.format === 'markdown') {
        console.log(renderCatalogMarkdown(catalog.capabilities, catalog.schemaVersion))
      } else {
        console.log(renderCatalogText(catalog.capabilities, catalog.schemaVersion))
      }
    } catch (error) {
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
    let parsed
    try {
      validateFormat(options.format, CHECK_FORMATS, 'capabilities check')
      parsed = parseRequirements(options.require)
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`)
      process.exit(EXIT_INVALID_INPUT)
    }

    const context = await resolveContext(command)
    const report = checkCapabilities(parsed.ids, context, parsed.warnings)

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(renderCheckText(report))
    }

    if (!report.ok) process.exit(EXIT_REQUIREMENTS_UNMET)
  })

// src/commands/proxy.ts
import { Command } from 'commander'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { join } from 'node:path'
import { ProxyServer } from '@/proxy/server'
import type { ProxyEngine, RedactMode } from '@/proxy/events'
import { readEvents } from '@/proxy/event-reader'
import { analyzeEvents } from '@/proxy/analyze'
import { renderAnalysisText } from '@/proxy/analyze-render'

const SUPPORTED: ProxyEngine[] = ['mysql', 'mariadb', 'postgresql']
const ALLOWED_FORMATS = ['text', 'json'] as const
const ALLOWED_REDACT = ['none', 'literals'] as const

export interface HostPort {
  host: string
  port: number
}

export function parseHostPort(value: string): HostPort {
  const idx = value.lastIndexOf(':')
  if (idx <= 0 || idx === value.length - 1) {
    throw new Error(`Invalid address "${value}". Expected host:port`)
  }
  const host = value.slice(0, idx)
  const port = Number(value.slice(idx + 1))
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port in "${value}". Expected host:port with a numeric port`)
  }
  return { host, port }
}

export interface ResolveInput {
  subcommandEngine: ProxyEngine | null
  listen: string | undefined
  target: string | undefined
  connection: { system: string; host: string; port: number } | null
}

export interface ResolvedProxy {
  engine: ProxyEngine
  listen: HostPort
  target: HostPort
}

export function resolveProxyConfig(input: ResolveInput): ResolvedProxy {
  if (!input.listen) {
    throw new Error('--listen <host:port> is required')
  }
  const listen = parseHostPort(input.listen)

  let engine: ProxyEngine
  if (input.subcommandEngine) {
    engine = input.subcommandEngine
  } else {
    const sys = input.connection?.system
    if (!sys || !SUPPORTED.includes(sys as ProxyEngine)) {
      throw new Error(`proxy supports mysql, mariadb, postgresql (got: ${sys ?? 'none'})`)
    }
    engine = sys as ProxyEngine
  }

  let target: HostPort
  if (input.target) {
    target = parseHostPort(input.target)
  } else if (input.connection) {
    target = { host: input.connection.host, port: input.connection.port }
  } else {
    throw new Error('--target <host:port> is required when config does not provide host/port')
  }

  return { engine, listen, target }
}

interface ProxyCliOptions {
  listen?: string
  target?: string
  events?: string
  slowMs?: string
  redact?: string
  format?: string
  config?: string
}

async function runProxy(
  subcommandEngine: ProxyEngine | null,
  options: ProxyCliOptions,
  command: Command
): Promise<void> {
  try {
    validateFormat(options.format ?? 'text', ALLOWED_FORMATS, 'proxy')
    const redact = (options.redact ?? 'none') as RedactMode
    if (!ALLOWED_REDACT.includes(redact)) {
      throw new Error(`Invalid --redact "${redact}". Allowed: none, literals`)
    }

    const configPath = resolveConfigPath(command, options)
    let connection: { system: string; host: string; port: number } | null = null
    try {
      const config = await configModule.read(configPath)
      if (config.connection) {
        // configModule.read() resolves env refs at runtime; cast to resolved primitive types.
        connection = {
          system: config.connection.system,
          host: config.connection.host as string,
          port: config.connection.port as number,
        }
      }
    } catch {
      // No config is fine when explicit engine + target are given.
    }

    const resolved = resolveProxyConfig({
      subcommandEngine,
      listen: options.listen,
      target: options.target,
      connection,
    })

    const eventsPath = options.events ?? join('.dbcli', 'proxy', 'events.jsonl')
    const slowMs = Number(options.slowMs ?? 1000)
    if (!Number.isFinite(slowMs) || slowMs < 0) {
      throw new Error(`Invalid --slow-ms "${options.slowMs}". Expected a non-negative number`)
    }

    const server = new ProxyServer({
      engine: resolved.engine,
      listen: resolved.listen,
      target: resolved.target,
      eventsPath,
      slowMs,
      redact,
      warn: (m) => process.stderr.write(`[proxy] ${m}\n`),
    })

    await server.start()

    if (options.format === 'json') {
      process.stdout.write(
        JSON.stringify({
          status: 'listening',
          engine: resolved.engine,
          listen: `${resolved.listen.host}:${resolved.listen.port}`,
          target: `${resolved.target.host}:${resolved.target.port}`,
          events: eventsPath,
          redact,
        }) + '\n'
      )
    } else {
      process.stdout.write(
        `dbcli proxy (${resolved.engine}) listening on ${resolved.listen.host}:${resolved.listen.port}` +
          ` -> ${resolved.target.host}:${resolved.target.port}\n` +
          `events: ${eventsPath} | slow-ms: ${slowMs} | redact: ${redact}\n` +
          `Press Ctrl+C to stop.\n`
      )
    }

    // Keep the process alive until interrupted.
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        process.removeListener('SIGINT', shutdown)
        process.removeListener('SIGTERM', shutdown)
        server.stop()
        resolve()
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
  } catch (error) {
    if (error instanceof Error) console.error(error.message)
    process.exit(1)
  }
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--listen <host:port>', 'Local proxy listen address (required)')
    .option('--target <host:port>', 'Upstream DB target (optional when config provides host/port)')
    .option('--events <path>', 'Event JSONL path', join('.dbcli', 'proxy', 'events.jsonl'))
    .option(
      '--slow-ms <number>',
      'Threshold (ms); queries at/above it get slow:true in the event + a terminal warning',
      '1000'
    )
    .option('--redact <mode>', 'SQL redaction: none | literals', 'none')
    .option('--format <format>', 'Runtime status output: text | json', 'text')
}

export const proxyCommand = new Command()
  .name('proxy')
  .description('Local development observability proxy for MySQL/MariaDB/PostgreSQL (observe-only)')

for (const engine of SUPPORTED) {
  addCommonOptions(proxyCommand.command(engine).description(`Proxy a ${engine} connection`)).action(
    async (options: ProxyCliOptions, command: Command) => {
      await runProxy(engine, options, command)
    }
  )
}

const ANALYZE_FORMATS = ['json', 'text'] as const

interface ProxyAnalyzeOptions {
  events?: string
  format?: string
  top?: string
  slowMs?: string
  nPlusOne?: string
  includeRotated?: boolean
}

function parseNonNegInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --${flag} "${value}". Expected a non-negative integer`)
  }
  return n
}

const ANALYZE_EVENTS_DEFAULT = join('.dbcli', 'proxy', 'events.jsonl')

async function runAnalyze(options: ProxyAnalyzeOptions, cmd: Command): Promise<void> {
  try {
    // Commander assigns options shared with the parent (e.g. --events, --format) to the
    // parent command when they appear after the subcommand name. Fall through to parent
    // opts for any option that landed at its default value.
    const parentOpts = (cmd.parent?.opts() ?? {}) as Record<string, unknown>
    const resolveStr = (local: string | undefined, parentKey: string, def: string): string =>
      local !== def ? (local ?? def) : ((parentOpts[parentKey] as string | undefined) ?? def)

    const eventsPath = resolveStr(options.events, 'events', ANALYZE_EVENTS_DEFAULT)
    const format = resolveStr(options.format, 'format', 'json')

    validateFormat(format, ANALYZE_FORMATS, 'proxy analyze')
    const top = parseNonNegInt(options.top, 'top', 20)
    const slowMs = parseNonNegInt(options.slowMs, 'slow-ms', 1000)
    const nPlusOne = parseNonNegInt(options.nPlusOne, 'n-plus-one', 10)

    const { events, malformedLines, files } = await readEvents(eventsPath, {
      includeRotated: options.includeRotated !== false,
    })
    if (files.length === 0) {
      throw new Error(`no events found at ${eventsPath}; run 'dbcli proxy <engine>' first`)
    }

    const report = analyzeEvents(events, {
      slowMs,
      top,
      nPlusOne,
      sourceFiles: files,
      malformedLines,
    })

    if (format === 'text') {
      process.stdout.write(renderAnalysisText(report, top) + '\n')
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    }
  } catch (error) {
    if (error instanceof Error) console.error(error.message)
    process.exit(1)
  }
}

proxyCommand
  .command('analyze')
  .description('Analyze a proxy event log offline (no DB connection)')
  .option('--events <path>', 'Event JSONL path', ANALYZE_EVENTS_DEFAULT)
  .option('--format <format>', 'Output format: json | text', 'json')
  .option('--top <number>', 'Rows shown in text + suggestedCommands depth', '20')
  .option('--slow-ms <number>', 'Slow-query threshold (ms) for slowCount', '1000')
  .option('--n-plus-one <number>', 'Min repeats per (session,fingerprint) to flag N+1', '10')
  .option('--no-include-rotated', 'Do not merge the rotated <events>.1 segment')
  .action(async (options: ProxyAnalyzeOptions, cmd: Command) => {
    await runAnalyze(options, cmd)
  })

// No-subcommand form: infer engine from config / --use.
addCommonOptions(proxyCommand).action(async (options: ProxyCliOptions, command: Command) => {
  await runProxy(null, options, command)
})

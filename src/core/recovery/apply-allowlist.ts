import type { RecoveryCode } from './types'

/**
 * Per-`RecoveryCode` argv allowlist for `dbcli recover --apply`.
 *
 * Each entry is a list of allowed argv shapes. An argv is allowed iff it
 * matches at least one shape. The grammar is intentionally loose: dbcli
 * already rejects unknown flags via commander, so the allowlist's primary
 * job is "block subcommands that aren't part of the recovery plan for this
 * error.code".
 */

interface ArgvShape {
  subcommand: string
  subSubcommand?: string
  flagWhitelist: string[]
  allowPositional?: boolean
}

const FORBIDDEN_TOKEN = /[;&|<>$`(){}*?]/

function connectionShapes(): ArgvShape[] {
  return [
    { subcommand: 'doctor', flagWhitelist: ['--format'], allowPositional: true },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--no-connect', '--format', '--for-agent'],
      allowPositional: true,
    },
    { subcommand: 'use', flagWhitelist: [], allowPositional: true },
    { subcommand: 'init', flagWhitelist: ['--force'] },
  ]
}

const SHAPES: Record<RecoveryCode, ArgvShape[]> = {
  CONFIG_MISSING: [
    { subcommand: 'init', flagWhitelist: ['--force'] },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--no-connect', '--for-agent', '--format'],
      allowPositional: true,
    },
  ],
  CONN_REFUSED: connectionShapes(),
  CONN_TIMEOUT: connectionShapes(),
  CONN_UNKNOWN: connectionShapes(),
  CONN_AUTH_FAILED: connectionShapes(),
  CONN_HOST_NOT_FOUND: connectionShapes(),
  PERMISSION_DENIED: [
    { subcommand: 'inspect', flagWhitelist: ['--for-agent', '--format'], allowPositional: true },
    { subcommand: 'guide', flagWhitelist: ['--for-agent', '--format'], allowPositional: true },
    { subcommand: 'init', flagWhitelist: ['--force'] },
    {
      subcommand: 'insert',
      flagWhitelist: ['--dry-run', '--data', '--force'],
      allowPositional: true,
    },
    {
      subcommand: 'update',
      flagWhitelist: ['--dry-run', '--where', '--set', '--force'],
      allowPositional: true,
    },
    {
      subcommand: 'delete',
      flagWhitelist: ['--dry-run', '--where', '--force'],
      allowPositional: true,
    },
  ],
  BLACKLIST_TABLE: [
    {
      subcommand: 'blacklist',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
    {
      subcommand: 'blacklist',
      subSubcommand: 'remove',
      flagWhitelist: [],
      allowPositional: true,
    },
    { subcommand: 'inspect', flagWhitelist: ['--for-agent', '--format'], allowPositional: true },
  ],
  BLACKLIST_COLUMN_WRITE: [
    {
      subcommand: 'blacklist',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
    { subcommand: 'schema', flagWhitelist: ['--format', '--refresh'], allowPositional: true },
    { subcommand: 'insert', flagWhitelist: ['--dry-run', '--data'], allowPositional: true },
    {
      subcommand: 'update',
      flagWhitelist: ['--dry-run', '--where', '--set'],
      allowPositional: true,
    },
    { subcommand: 'delete', flagWhitelist: ['--dry-run', '--where'], allowPositional: true },
  ],
  SNIPPET_NOT_FOUND: [
    {
      subcommand: 'queries',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
    {
      subcommand: 'queries',
      subSubcommand: 'search',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
    {
      subcommand: 'queries',
      subSubcommand: 'suggest',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
  ],
  SNIPPET_AMBIGUOUS: [
    {
      subcommand: 'queries',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
    {
      subcommand: 'q',
      flagWhitelist: ['--dry-run', '--format', '--no-limit', '--param', '--param-file'],
      allowPositional: true,
    },
  ],
  SNIPPET_PARAM_MISSING: [
    {
      subcommand: 'q',
      flagWhitelist: ['--dry-run', '--format', '--no-limit', '--param', '--param-file'],
      allowPositional: true,
    },
    {
      subcommand: 'queries',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
    },
  ],
  SCHEMA_CACHE_MISSING: [
    { subcommand: 'schema', flagWhitelist: ['--refresh', '--format'], allowPositional: true },
    { subcommand: 'list', flagWhitelist: ['--format'], allowPositional: true },
    { subcommand: 'inspect', flagWhitelist: ['--format', '--for-agent'], allowPositional: true },
  ],
  UNKNOWN: [
    { subcommand: 'doctor', flagWhitelist: ['--format'], allowPositional: true },
    { subcommand: 'inspect', flagWhitelist: ['--for-agent', '--format'], allowPositional: true },
  ],
}

export function isAllowedForCode(argv: string[], code: RecoveryCode): boolean {
  if (argv.length < 2) return false
  if (argv[0] !== 'dbcli') return false
  for (const tok of argv) {
    if (FORBIDDEN_TOKEN.test(tok)) return false
  }
  const shapes = SHAPES[code] ?? []
  return shapes.some((shape) => matchesShape(argv, shape))
}

function matchesShape(argv: string[], shape: ArgvShape): boolean {
  if (argv[1] !== shape.subcommand) return false
  let cursor = 2
  if (shape.subSubcommand !== undefined) {
    if (argv[2] !== shape.subSubcommand) return false
    cursor = 3
  }
  for (let i = cursor; i < argv.length; i++) {
    const tok = argv[i]!
    if (tok.startsWith('--')) {
      const name = tok.split('=')[0]!
      if (!shape.flagWhitelist.includes(name)) return false
    } else if (!shape.allowPositional) {
      return false
    }
  }
  return true
}

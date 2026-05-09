import type { RecoveryCode } from './types'
import type { ApplyTier, ArgvClassification } from './apply-types'

/**
 * Per-`RecoveryCode` argv allowlist for `dbcli recover --apply`.
 *
 * Each shape declares the canonical execution tier (`tier`) for matching
 * argv; the gate uses this tier — **not** the envelope's `risk` field — to
 * decide whether a step may run. Envelope hints (`risk`, `dbWrite`) are
 * informational only.
 *
 * For write subcommands (`insert`, `update`, `delete`, `q`) the tier depends
 * on whether `--dry-run` is present; the shape's `tier` field is a function.
 *
 * The grammar is deliberately loose on positional arguments because dbcli
 * itself rejects unknown flags via commander; the allowlist's primary job is
 * to keep argv inside the recovery plan envelope dbcli already knows how to
 * run for this `error.code`.
 */

interface ArgvShape {
  subcommand: string
  subSubcommand?: string
  flagWhitelist: string[]
  allowPositional?: boolean
  /** Code-owned execution tier for matching argv. Constant or computed from argv. */
  tier: ApplyTier | ((argv: string[]) => ApplyTier)
}

const FORBIDDEN_TOKEN = /[;&|<>$`(){}*?]/

const dryRunOrDbWrite = (argv: string[]): ApplyTier =>
  argv.includes('--dry-run') ? 'dry-run' : 'db-write'

const refreshOrReadonly = (argv: string[]): ApplyTier =>
  argv.includes('--refresh') ? 'local-write' : 'readonly'

function connectionShapes(): ArgvShape[] {
  return [
    { subcommand: 'doctor', flagWhitelist: ['--format'], allowPositional: true, tier: 'readonly' },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--no-connect', '--format', '--for-agent'],
      allowPositional: true,
      tier: 'readonly',
    },
    // `dbcli use <name>` updates the active connection in config — local write.
    { subcommand: 'use', flagWhitelist: [], allowPositional: true, tier: 'local-write' },
    { subcommand: 'init', flagWhitelist: ['--force'], tier: 'interactive' },
  ]
}

const SHAPES: Record<RecoveryCode, ArgvShape[]> = {
  CONFIG_MISSING: [
    { subcommand: 'init', flagWhitelist: ['--force'], tier: 'interactive' },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--no-connect', '--for-agent', '--format'],
      allowPositional: true,
      tier: 'readonly',
    },
  ],
  CONN_REFUSED: connectionShapes(),
  CONN_TIMEOUT: connectionShapes(),
  CONN_UNKNOWN: connectionShapes(),
  CONN_AUTH_FAILED: connectionShapes(),
  CONN_HOST_NOT_FOUND: connectionShapes(),
  PERMISSION_DENIED: [
    {
      subcommand: 'inspect',
      flagWhitelist: ['--for-agent', '--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'guide',
      flagWhitelist: ['--for-agent', '--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    { subcommand: 'init', flagWhitelist: ['--force'], tier: 'interactive' },
    {
      subcommand: 'insert',
      flagWhitelist: ['--dry-run', '--data', '--force'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
    {
      subcommand: 'update',
      flagWhitelist: ['--dry-run', '--where', '--set', '--force'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
    {
      subcommand: 'delete',
      flagWhitelist: ['--dry-run', '--where', '--force'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
  ],
  BLACKLIST_TABLE: [
    {
      subcommand: 'blacklist',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'blacklist',
      subSubcommand: 'remove',
      flagWhitelist: [],
      allowPositional: true,
      tier: 'local-write',
    },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--for-agent', '--format'],
      allowPositional: true,
      tier: 'readonly',
    },
  ],
  BLACKLIST_COLUMN_WRITE: [
    {
      subcommand: 'blacklist',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'schema',
      flagWhitelist: ['--format', '--refresh'],
      allowPositional: true,
      tier: refreshOrReadonly,
    },
    {
      subcommand: 'insert',
      flagWhitelist: ['--dry-run', '--data'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
    {
      subcommand: 'update',
      flagWhitelist: ['--dry-run', '--where', '--set'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
    {
      subcommand: 'delete',
      flagWhitelist: ['--dry-run', '--where'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
  ],
  SNIPPET_NOT_FOUND: [
    {
      subcommand: 'queries',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'queries',
      subSubcommand: 'search',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'queries',
      subSubcommand: 'suggest',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
  ],
  SNIPPET_AMBIGUOUS: [
    {
      subcommand: 'queries',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'q',
      flagWhitelist: ['--dry-run', '--format', '--no-limit', '--param', '--param-file'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
  ],
  SNIPPET_PARAM_MISSING: [
    {
      subcommand: 'q',
      flagWhitelist: ['--dry-run', '--format', '--no-limit', '--param', '--param-file'],
      allowPositional: true,
      tier: dryRunOrDbWrite,
    },
    {
      subcommand: 'queries',
      subSubcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
  ],
  SCHEMA_CACHE_MISSING: [
    {
      subcommand: 'schema',
      flagWhitelist: ['--refresh', '--format'],
      allowPositional: true,
      tier: refreshOrReadonly,
    },
    {
      subcommand: 'list',
      flagWhitelist: ['--format'],
      allowPositional: true,
      tier: 'readonly',
    },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--format', '--for-agent'],
      allowPositional: true,
      tier: 'readonly',
    },
  ],
  UNKNOWN: [
    { subcommand: 'doctor', flagWhitelist: ['--format'], allowPositional: true, tier: 'readonly' },
    {
      subcommand: 'inspect',
      flagWhitelist: ['--for-agent', '--format'],
      allowPositional: true,
      tier: 'readonly',
    },
  ],
}

/**
 * Classify a parsed argv against the allowlist for the given recovery code.
 * Returns the code-owned tier (authoritative for the gate) or a structured
 * unsafe result with a human-readable reason.
 */
export function classifyArgvForCode(argv: string[], code: RecoveryCode): ArgvClassification {
  if (argv.length < 2) {
    return { kind: 'unsafe', reason: 'argv must contain at least `dbcli <subcommand>`' }
  }
  if (argv[0] !== 'dbcli') {
    return { kind: 'unsafe', reason: `argv[0] must be 'dbcli' (got '${argv[0]}')` }
  }
  for (const tok of argv) {
    if (FORBIDDEN_TOKEN.test(tok)) {
      return { kind: 'unsafe', reason: `argv token contains forbidden character: '${tok}'` }
    }
  }
  const shapes = SHAPES[code] ?? []
  for (const shape of shapes) {
    if (matchesShape(argv, shape)) {
      const tier = typeof shape.tier === 'function' ? shape.tier(argv) : shape.tier
      return { kind: 'allowed', tier }
    }
  }
  return {
    kind: 'unsafe',
    reason: `Command is not in the allowlist for error.code=${code}.`,
  }
}

/**
 * Backward-compatible boolean wrapper. Prefer {@link classifyArgvForCode} for
 * new code so the gate can use the code-owned tier instead of trusting the
 * envelope's `risk` field.
 */
export function isAllowedForCode(argv: string[], code: RecoveryCode): boolean {
  return classifyArgvForCode(argv, code).kind === 'allowed'
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

import type { GuideStep } from '@/core/guide/types'
import type { RecoveryCode, RecoveryContext } from './types'

/** Hard cap on emitted recovery steps; prevents drowning agents in suggestions. */
export const MAX_RECOVERY_STEPS = 6

type StepDraft = Omit<GuideStep, 'order'>

/**
 * POSIX shell-quote a value before splicing it into an agent-runnable command.
 *
 * Identifiers built from a safe character set are returned untouched so simple
 * cases like `dbcli use staging` stay readable. Anything else is wrapped in
 * single quotes (with embedded single quotes escaped via the standard
 * `'\''` dance) so a hostile table / snippet / hint name cannot break out and
 * inject a follow-on shell command.
 */
function shellQuote(value: string): string {
  if (value.length === 0) return "''"
  if (/^[A-Za-z0-9_./@:+,=-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Build the dry-run preview step that gets prepended to BLACKLIST_COLUMN_WRITE
 * and PERMISSION_DENIED branches when ctx.writeOperation indicates a write.
 *
 * Returns null when the operation was not a write, so the readonly-only step
 * shape from v1.15.0 is preserved on read paths.
 */
function dryRunStepForWrite(
  ctx: RecoveryContext,
  quotedTable: string,
  placeholders?: string[]
): StepDraft | null {
  if (!ctx.writeOperation) return null
  const verb = ctx.writeOperation.toLowerCase()
  const draft: StepDraft = {
    command: `dbcli ${verb} ${quotedTable} --dry-run`,
    rationale:
      'Preview the SQL that would be executed before changing permission, blacklist, or data; --dry-run never mutates the database.',
    risk: 'dry-run',
    expects: 'Generated SQL output; no rows affected.',
  }
  if (placeholders && placeholders.length > 0) draft.placeholders = placeholders
  return draft
}

export function stepsForCode(code: RecoveryCode, ctx: RecoveryContext): GuideStep[] {
  const drafts = draftsForCode(code, ctx)
  return drafts.slice(0, MAX_RECOVERY_STEPS).map((d, i) => ({ ...d, order: i + 1 }))
}

function draftsForCode(code: RecoveryCode, ctx: RecoveryContext): StepDraft[] {
  switch (code) {
    case 'CONFIG_MISSING':
      return [
        {
          command: 'dbcli init',
          rationale: 'No dbcli configuration detected; run the init wizard to create it.',
          risk: 'write',
          expects: 'Init wizard prompts for system, connection name, and credentials.',
          interactive: true,
        },
        {
          command: 'dbcli inspect --no-connect --format json',
          rationale: 'After init, confirm the workspace shape before connecting.',
          risk: 'readonly',
          expects: 'JSON snapshot with system + permission + blacklist + snippets sections.',
        },
      ]

    case 'CONN_REFUSED':
    case 'CONN_TIMEOUT':
    case 'CONN_UNKNOWN': {
      const out: StepDraft[] = [
        {
          command: 'dbcli doctor --format json',
          rationale: 'Run the doctor health check to identify config / network / driver issues.',
          risk: 'readonly',
          expects: 'JSON report listing config validation, env presence, connection reachability.',
        },
        {
          command: 'dbcli inspect --no-connect --format json',
          rationale:
            'Re-read the cached connection summary without a live probe to compare expected vs actual host/port.',
          risk: 'readonly',
          expects: 'JSON snapshot with connection.name and connection.database (no creds).',
        },
      ]
      if (ctx.connectionName) {
        out.push({
          command: `dbcli use ${shellQuote(ctx.connectionName)}`,
          rationale:
            'Re-select the failing named connection so subsequent commands target it explicitly.',
          risk: 'readonly',
          expects: 'Confirmation that the active connection switched to the requested name.',
        })
      }
      return out
    }

    case 'CONN_AUTH_FAILED':
    case 'CONN_HOST_NOT_FOUND':
      return [
        {
          command: 'dbcli doctor --format json',
          rationale: 'Verify config integrity (hostname, port, env-loaded credentials).',
          risk: 'readonly',
          expects: 'JSON report flagging missing env vars or unreachable host.',
        },
        {
          command: 'dbcli init --force',
          rationale: 'Re-run the init wizard to overwrite stale credentials or hostname.',
          risk: 'write',
          expects: 'Init wizard accepts new values and rewrites the active config file.',
          interactive: true,
        },
      ]

    case 'PERMISSION_DENIED': {
      const usedTablePlaceholder = !ctx.table
      const table = ctx.table ? shellQuote(ctx.table) : '<table>'
      const out: StepDraft[] = []
      const dryRun = dryRunStepForWrite(
        ctx,
        table,
        usedTablePlaceholder ? ['<table>'] : undefined
      )
      if (dryRun) out.push(dryRun)
      out.push(
        {
          command: 'dbcli inspect --for-agent',
          rationale: 'Confirm the active permission level and capability flags.',
          risk: 'readonly',
          expects: 'Brief JSON with permission.level / canWrite / canDestruct fields.',
        },
        {
          command: 'dbcli guide permissions --for-agent',
          rationale:
            'Walk the guide steps for auditing permission, blacklist, and snippet inventory.',
          risk: 'readonly',
          expects: 'Guide JSON whose first step is `dbcli inspect --for-agent`.',
        },
        {
          command: 'dbcli init --force',
          rationale:
            'If the operation legitimately requires more access, re-run init to set a higher permission level.',
          risk: 'write',
          expects: 'Init wizard rewrites the permission field in the active config.',
          interactive: true,
        }
      )
      return out
    }

    case 'BLACKLIST_TABLE': {
      const usedPlaceholder = !ctx.table
      const table = ctx.table ? shellQuote(ctx.table) : '<table>'
      return [
        {
          command: 'dbcli blacklist list --format json',
          rationale: 'Inventory the current blacklist before deciding whether to amend it.',
          risk: 'readonly',
          expects: 'JSON listing blacklisted tables and column rules.',
        },
        {
          command: 'dbcli inspect --for-agent',
          rationale: 'Confirm permission + blacklist context.',
          risk: 'readonly',
          expects: 'Brief JSON snapshot.',
        },
        {
          command: `dbcli blacklist remove ${table}`,
          rationale: 'Remove the table from the blacklist if access is justified.',
          risk: 'write',
          expects: 'Confirmation that the table was removed from the blacklist file.',
          ...(usedPlaceholder ? { placeholders: ['<table>'] } : {}),
        },
      ]
    }

    case 'BLACKLIST_COLUMN_WRITE': {
      const usedTablePlaceholder = !ctx.table
      const table = ctx.table ? shellQuote(ctx.table) : '<table>'
      const out: StepDraft[] = []
      const dryRun = dryRunStepForWrite(
        ctx,
        table,
        usedTablePlaceholder ? ['<table>'] : undefined
      )
      if (dryRun) out.push(dryRun)
      out.push(
        {
          command: 'dbcli blacklist list --format json',
          rationale: 'Inventory column-level blacklist rules so the write can be reshaped.',
          risk: 'readonly',
          expects: 'JSON listing blacklisted columns per table.',
        },
        {
          command: `dbcli schema ${table} --format json`,
          rationale:
            'Inspect the target schema and pick a write that does not touch blacklisted columns.',
          risk: 'readonly',
          expects: 'Schema JSON for the table.',
          ...(usedTablePlaceholder ? { placeholders: ['<table>'] } : {}),
        }
      )
      return out
    }

    case 'SNIPPET_NOT_FOUND': {
      const rawHint = ctx.hint ?? ctx.snippet
      const usedHintPlaceholder = !rawHint
      const hint = rawHint ? shellQuote(rawHint) : '<hint>'
      return [
        {
          command: 'dbcli queries list --format json',
          rationale: 'Inventory all available snippets to find a near match.',
          risk: 'readonly',
          expects: 'JSON list of snippets with engine + intent + source.',
        },
        {
          command: `dbcli queries search ${hint}`,
          rationale: 'Fuzzy keyword search; uses the failed name (or operation hint) as the query.',
          risk: 'readonly',
          expects: 'Ranked list of snippet keys with scores.',
          ...(usedHintPlaceholder ? { placeholders: ['<hint>'] } : {}),
        },
        {
          command: 'dbcli queries suggest perf --format json',
          rationale: 'Browse curated snippets by intent prefix.',
          risk: 'readonly',
          expects: 'Snippets with intent prefix `perf.*`.',
        },
      ]
    }

    case 'SNIPPET_AMBIGUOUS': {
      const usedSnippetPlaceholder = !ctx.snippet
      const snippet = ctx.snippet ? shellQuote(ctx.snippet) : '<snippet>'
      return [
        {
          command: 'dbcli queries list --format json',
          rationale:
            'List all variants of the ambiguous key so the agent can pick the engine-specific one.',
          risk: 'readonly',
          expects: 'JSON list — look for duplicates of the snippet key under different engines.',
        },
        {
          command: `dbcli q ${snippet} --dry-run`,
          rationale: 'Dry-run the snippet to inspect the bound SQL before committing to a variant.',
          risk: 'dry-run',
          expects: 'Final SQL + bind values; no execution.',
          ...(usedSnippetPlaceholder ? { placeholders: ['<snippet>'] } : {}),
        },
      ]
    }

    case 'SNIPPET_PARAM_MISSING': {
      const usedSnippetPlaceholder = !ctx.snippet
      const snippet = ctx.snippet ? shellQuote(ctx.snippet) : '<snippet>'
      const param = ctx.hint ? shellQuote(ctx.hint) : '<name>'
      const placeholders: string[] = []
      if (usedSnippetPlaceholder) placeholders.push('<snippet>')
      placeholders.push('<name>', '<value>')
      return [
        {
          command: `dbcli q ${snippet} --dry-run --param ${param}=<value>`,
          rationale:
            'Re-invoke the snippet with the required parameter set; --dry-run previews the SQL safely.',
          risk: 'dry-run',
          expects: 'Final SQL with the param bound; no execution.',
          placeholders,
        },
        {
          command: 'dbcli queries list --format json',
          rationale: 'Reference the snippet inventory for parameter shape and defaults.',
          risk: 'readonly',
          expects: 'JSON list including snippet meta.params.',
        },
      ]
    }

    case 'SCHEMA_CACHE_MISSING':
      return [
        {
          command: 'dbcli schema --refresh',
          rationale:
            'Local schema cache is missing or stale; refresh it before relying on cached column metadata.',
          risk: 'readonly',
          expects: 'Updated `.dbcli/schemas/index.json` with current table → column mapping.',
        },
        {
          command: 'dbcli list --format json',
          rationale: 'Confirm the database actually contains the expected tables/collections.',
          risk: 'readonly',
          expects: 'JSON object list keyed by engine kind.',
        },
        {
          command: 'dbcli inspect --format json',
          rationale: 'Re-anchor in the post-refresh context.',
          risk: 'readonly',
          expects: 'JSON snapshot with schemaCache.available = true.',
        },
      ]

    case 'UNKNOWN':
    default:
      return [
        {
          command: 'dbcli doctor --format json',
          rationale: 'Run the doctor health check to isolate the failure mode.',
          risk: 'readonly',
          expects: 'JSON report listing detected issues.',
        },
        {
          command: 'dbcli inspect --for-agent',
          rationale: 'Re-anchor the agent in the current context before retrying.',
          risk: 'readonly',
          expects: 'Brief JSON snapshot.',
        },
      ]
  }
}

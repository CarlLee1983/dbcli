import type { GuideStep } from '@/core/guide/types'
import { STATEMENT_TIMEOUT_CODE, type RecoveryCode, type RecoveryContext } from './types'
import { shellQuote } from './shell-quote'

/** Hard cap on emitted recovery steps; prevents drowning agents in suggestions. */
export const MAX_RECOVERY_STEPS = 6

type StepDraft = Omit<GuideStep, 'order'>

/**
 * Build the dry-run preview step that gets prepended to BLACKLIST_COLUMN_WRITE
 * and PERMISSION_DENIED branches when ctx.writeOperation indicates a write.
 *
 * Returns null when the operation was not a write, so the readonly-only step
 * shape from v1.15.0 is preserved on read paths.
 *
 * Each verb requires args (`--data` / `--set` / `--where`) that the agent must
 * supply. We embed them as `<...>` placeholders so the apply gate marks the
 * step `skipped:placeholder` instead of running an arg-less command that would
 * exit non-zero and fail-fast the recovery loop.
 */
function dryRunStepForWrite(
  ctx: RecoveryContext,
  quotedTable: string,
  placeholders?: string[]
): StepDraft | null {
  if (!ctx.writeOperation) return null
  const verb = ctx.writeOperation.toLowerCase()
  const argSpec =
    verb === 'insert'
      ? { fragment: '--data <data>', tokens: ['<data>'] }
      : verb === 'update'
        ? { fragment: '--set <set> --where <where>', tokens: ['<set>', '<where>'] }
        : { fragment: '--where <where>', tokens: ['<where>'] }
  const draft: StepDraft = {
    command: `dbcli ${verb} ${quotedTable} ${argSpec.fragment} --dry-run`,
    rationale:
      'Preview the SQL that would be executed before changing permission, blacklist, or data; --dry-run never mutates the database.',
    risk: 'dry-run',
    expects: 'Generated SQL output; no rows affected.',
    placeholders: [...(placeholders ?? []), ...argSpec.tokens],
  }
  return draft
}

/**
 * Plan for a statement the server canceled (PostgreSQL 57014, MySQL 3024,
 * MariaDB 1969). The connection is healthy, so the plan works on the query:
 * an offline static read first, then the plan, then a re-run with a raised
 * ceiling. All three carry `<sql>` placeholders — the agent supplies the
 * statement it just lost, and `--apply` skips them rather than running blind.
 */
function statementTimeoutSteps(): StepDraft[] {
  return [
    {
      command: 'dbcli lint "<sql>"',
      rationale:
        'Static anti-pattern read of the statement; needs no connection, so it cannot time out in turn.',
      risk: 'readonly',
      expects: 'Findings with rewrite drafts, or an empty list when nothing is flagged.',
      placeholders: ['<sql>'],
    },
    {
      command: 'dbcli explain "<sql>"',
      rationale: 'Read the query plan to find the scan or join that exceeded the statement limit.',
      risk: 'readonly',
      expects: 'Annotated query plan; look for sequential scans and unindexed joins.',
      placeholders: ['<sql>'],
    },
    {
      command: 'dbcli --statement-timeout <ms> query "<sql>"',
      rationale:
        'Re-run with an explicit ceiling once the cost is understood; 0 removes the limit entirely.',
      risk: 'readonly',
      expects: 'Query result, or the same timeout if <ms> is still below what the plan costs.',
      placeholders: ['<ms>', '<sql>'],
    },
  ]
}

/**
 * TLS 握手失敗。`dbcli init` 問的是 system / host / 帳密，沒有一個欄位是憑證，
 * 所以連線類別的預設計畫在這裡走不通；改設定檔的信任來源才是補救。
 */
function tlsErrorSteps(): StepDraft[] {
  return [
    {
      command: 'dbcli status --format json',
      rationale:
        'Read back the active connection without a live probe to confirm which host and TLS settings are in force.',
      risk: 'readonly',
      expects: 'JSON status with system / permission; no credentials.',
    },
    {
      command: 'dbcli doctor --format json',
      rationale:
        'Doctor reports the handshake failure verbatim, which names the certificate problem (expired, self-signed, altname mismatch).',
      risk: 'readonly',
      expects: 'JSON report whose connection check fails with the TLS error text.',
    },
  ]
}

/**
 * 連線數用盡。等待與觀測是唯二有效的動作——重寫 host/port 不會生出連線槽。
 */
function connectionsExhaustedSteps(ctx: RecoveryContext): StepDraft[] {
  const inspectSql =
    ctx.system === 'postgresql'
      ? 'SELECT count(*) FROM pg_stat_activity'
      : 'SHOW STATUS LIKE "Threads_connected"'
  return [
    {
      command: `dbcli query ${shellQuote(inspectSql)} --format json`,
      rationale:
        'Count the connections currently held so the limit can be compared against real usage; needs one free slot, so it may have to wait.',
      risk: 'readonly',
      expects: 'A single row with the current connection count.',
    },
    {
      command: 'dbcli doctor --format json',
      rationale:
        'Once a slot frees up, confirm the connection itself is healthy — the config was never the problem.',
      risk: 'readonly',
      expects: 'JSON report with the connection check passing.',
    },
  ]
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
      // 語句逾時共用 CONN_TIMEOUT，但連線是通的——doctor / inspect 只會把方向帶偏。
      // classifyConnection 保證它只映到 CONN_TIMEOUT，這裡照樣收窄到那一碼。
      if (code === 'CONN_TIMEOUT' && ctx.connectionCode === STATEMENT_TIMEOUT_CODE) {
        return statementTimeoutSteps()
      }
      // 這兩種連線失敗的補救與 doctor / init 那條路無關：憑證要改設定檔的信任來源，
      // 連線數滿則是唯一保證「改設定沒用」的情況——池滿時 doctor 只會再失敗一次，
      // 而它的訊息含 refused，會把分支解析器導向「重寫 host/port」。
      if (ctx.connectionCode === 'TLS_ERROR') return tlsErrorSteps()
      if (ctx.connectionCode === 'TOO_MANY_CONNECTIONS') return connectionsExhaustedSteps(ctx)
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
          // `dbcli use <name>` rewrites the active-connection field in config — local write,
          // not readonly. Marked dbWrite:false because it does not touch the database.
          risk: 'write',
          dbWrite: false,
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
      const dryRun = dryRunStepForWrite(ctx, table, usedTablePlaceholder ? ['<table>'] : undefined)
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
      const dryRun = dryRunStepForWrite(ctx, table, usedTablePlaceholder ? ['<table>'] : undefined)
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

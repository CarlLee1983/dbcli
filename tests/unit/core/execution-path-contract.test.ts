/**
 * Structural contract for database execution paths.
 *
 * Every hole fixed in this area had the same shape: a gate existed, but a path
 * to the adapter did not pass through it. Enumerating the paths is what found
 * the last two — `q --verify` and the MongoDB export branch — after four
 * separate audits had missed them.
 *
 * This test does not prevent a new path. It makes one impossible to add
 * silently: any new or moved `<something>Adapter.execute(...)` call outside
 * `src/adapters/` fails here until it is registered below with the gate that
 * proves what it may execute.
 */

import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(import.meta.dir, '../../../src')

/**
 * Adapter entry points that reach the database. `execute` carries user SQL;
 * `insert` / `update` / `delete` are the typed write paths, which an earlier
 * version of this contract did not count at all.
 *
 * This is a heuristic over source text, not a type-level guarantee: a receiver
 * not named `*adapter`, a call split across lines, or `adapter['execute']`
 * would evade it. It is a tripwire for the ordinary case, and the registry
 * below is the actual record.
 */
const EXECUTE_CALL = /\w*[Aa]dapter\.(?:execute|insert|update|delete|request)\s*[<(]/g

/**
 * Registered execution paths and the gate each relies on. Update this table in
 * the same change that adds a call site, and say which gate proves it safe.
 */
const REGISTERED_PATHS: Record<string, { calls: number; gate: string }> = {
  'core/query-executor.ts': {
    calls: 1,
    gate: 'enforcePermission() — permission tier, stacked statements, blacklist',
  },
  'core/data-executor.ts': {
    calls: 3,
    gate: 'enforcePermission() per operation — insert/update/delete require data-admin',
  },
  'core/ddl-executor.ts': {
    calls: 1,
    gate: 'migrate command — DDL is dry-run unless --execute, admin permission required',
  },
  'core/health-checker.ts': {
    calls: 5,
    gate: 'no user SQL — fixed count/null/orphan/duplicate probes built from schema metadata',
  },
  'core/repl/repl-engine.ts': {
    calls: 1,
    gate:
      'checkPermission() before execution in the interactive shell, plus its own ' +
      'blacklist table check and column masking — the shell does not use QueryExecutor',
  },
  'core/report/run-diagnostic.ts': {
    calls: 1,
    gate:
      'snippet read-only contract at parse time — no permission tier is applied here, ' +
      'and the collector loads shared/local user snippets, not just built-ins; ' +
      'blacklist table check and column masking applied around this call',
  },
  'commands/insert.ts': {
    calls: 2,
    gate: 'enforcePermission() — requires data-admin before the typed insert',
  },
  'commands/update.ts': {
    calls: 2,
    gate: 'enforcePermission() — requires data-admin before the typed update',
  },
  'commands/delete.ts': {
    calls: 2,
    gate: 'explicit data-admin check in the command before the typed delete',
  },
  'commands/query.ts': {
    calls: 3,
    gate:
      'preflightQuery() — Redis/Elasticsearch permission, MongoDB write-stage guard, ' +
      'and blacklist over every referenced table/collection including $lookup / $unionWith',
  },
  'commands/export.ts': {
    calls: 3,
    gate:
      'QueryExecutor (with blacklist validator) for SQL; Redis permission; ' +
      'MongoDB write-stage guard; Elasticsearch index check and column masking',
  },
  'commands/q.ts': {
    calls: 2,
    gate:
      'snippet body and verify.query proven read-only at parse time; blacklist checked at ' +
      'run time against every table referenced by the body AND by verify.query',
  },
  'commands/es-shell.ts': {
    calls: 1,
    gate:
      'runEsRequest() — the resolved path is checked segment by segment against the index ' +
      'blacklist, unscoped non-metadata paths are refused, index names in the request body ' +
      'are checked, and blacklisted fields are removed from the response',
  },
  'commands/q-mongo.ts': {
    calls: 1,
    gate:
      'MongoDB write-stage guard — snippets refuse $out/$merge at every permission level; ' +
      'blacklist over the named collection and every $lookup / $unionWith source',
  },
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

function findExecutionPaths(): Record<string, number> {
  const found: Record<string, number> = {}
  for (const file of walk(SRC)) {
    // Keys in REGISTERED_PATHS are POSIX-style, so the walk must be too —
    // otherwise Windows both mismatches every key and, worse, silently loses
    // the `adapters/` exclusion below.
    const rel = relative(SRC, file).split(sep).join('/')
    if (rel.startsWith('adapters/')) continue
    const matches = readFileSync(file, 'utf8').match(EXECUTE_CALL)
    if (matches && matches.length > 0) found[rel] = matches.length
  }
  return found
}

describe('database execution paths are registered with a gate', () => {
  test('no adapter execution happens outside a registered path', () => {
    const actual = findExecutionPaths()
    const expected = Object.fromEntries(
      Object.entries(REGISTERED_PATHS).map(([file, entry]) => [file, entry.calls])
    )

    // A diff here means a call site was added, removed, or moved. Register it
    // in REGISTERED_PATHS with the gate that proves what it may execute — and
    // if there is no such gate, that is the finding, not the test.
    expect(actual).toEqual(expected)
  })

  test('every registered path states its gate', () => {
    for (const [file, entry] of Object.entries(REGISTERED_PATHS)) {
      expect(entry.gate.trim().length, `${file} must state a gate`).toBeGreaterThan(0)
    }
  })
})

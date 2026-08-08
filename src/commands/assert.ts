// src/commands/assert.ts
import { Command } from 'commander'
import { basename } from 'node:path'
import {
  AdapterFactory,
  ConnectionError,
  type ConnectionOptions,
  type SqlConnectionOptions,
} from '@/adapters'
import { configModule } from '@/core/config'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { QueryExecutor } from '@/core/query-executor'
import {
  loadSnippets,
  mapSystemToEngine,
  resolveByName,
  resolveSnippetDirs,
} from '@/core/saved-queries'
import { parseExpect } from '@/core/assert/grammar'
import { evaluateExpect, compareVs } from '@/core/assert/evaluator'
import { buildFingerprint, compareAgainst } from '@/core/result-snapshot/fingerprint'
import { readSnapshot } from '@/core/result-snapshot/serializer'
import { writeAuditEntry } from '@/core/audit/integration-helper'
import type { AssertCheck, AssertVerdict, SnapshotEngine } from '@/core/result-snapshot/types'
import type { QueryResult } from '@/types/query'
import {
  parseVerificationSubject,
  buildAssertVerificationArtifact,
  writeVerificationArtifact,
  AssertArtifactError,
} from '@/core/verification'
import type { VerificationSubject } from '@/core/verification'
import { buildEvidenceReceipt, writeEvidenceReceipt } from '@/core/evidence-receipt'
import { redactArgv } from '@/utils/redaction'
import { buildEvidenceReceiptContext } from '@/commands/evidence-receipt-context'

const ALLOWED_FORMATS = ['json', 'table'] as const
const SQL_SYSTEMS = ['postgresql', 'mysql', 'mariadb']

function requireSqlConnection(connection: ConnectionOptions): SqlConnectionOptions {
  if (!SQL_SYSTEMS.includes(connection.system)) {
    throw new Error(`assert currently supports SQL engines only, got: ${connection.system}`)
  }
  return connection as SqlConnectionOptions
}

export const assertCommand = new Command()
  .name('assert')
  .description('Assert an invariant on a query result (exit 1 on failure unless --no-fail)')
  .argument('<query>', 'SQL string or @saved-query reference')
  .option('--expect <condition>', 'e.g. "rows > 0", "value == 5000", "col:email not null"')
  .option('--vs <query>', 'Second SQL/@saved query for reconciliation')
  .option('--compare <mode>', 'For --vs: rows | value (default value)', 'value')
  .option('--against <path>', 'Compare current result fingerprint against a saved snapshot')
  .option(
    '--tolerance <pct>',
    'For --against: allowed relative drift, e.g. 0.01 (default 0)',
    (v) => parseFloat(v),
    0
  )
  .option('--no-fail', 'Always exit 0; report pass/fail in output only')
  .option('--format <format>', 'Output format: json (default) or table', 'json')
  .option(
    '--write-verification-artifact',
    'After the verdict, persist a VerificationArtifact JSON under .dbcli/verification/',
    false
  )
  .option(
    '--verification-subject <subject>',
    'Required with --write-verification-artifact: "<kind>:<name>"'
  )
  .option('--verification-summary <text>', 'Optional summary text for the verification artifact')
  .option(
    '--evidence-receipt <path>',
    'Write a safe provenance receipt after the assertion outcome is authoritative'
  )
  .action(async (query: string, options: Record<string, unknown>, command: Command) => {
    try {
      validateFormat(options.format as string, ALLOWED_FORMATS, 'assert')
      if (!options.expect && !options.vs && !options.against) {
        console.error('Specify one of --expect, --vs, or --against')
        process.exit(1)
      }
      let verificationSubject: VerificationSubject | undefined
      if (options.writeVerificationArtifact === true) {
        const raw = options.verificationSubject as string | undefined
        if (!raw) {
          console.error(
            '--write-verification-artifact requires --verification-subject "<kind>:<name>"'
          )
          process.exit(1)
        }
        try {
          verificationSubject = parseVerificationSubject(raw)
        } catch (e) {
          // AssertArtifactError (or any parse failure) exits before any DB connection.
          console.error(
            e instanceof AssertArtifactError || e instanceof Error
              ? (e as Error).message
              : String(e)
          )
          process.exit(1)
        }
      }
      const configPath = resolveConfigPath(command, options as { config?: string })
      const config = await configModule.read(configPath)
      if (!config.connection) {
        console.error('Database not configured. Run: dbcli init')
        process.exit(1)
      }

      const adapter = AdapterFactory.createSqlAdapter(
        requireSqlConnection(config.connection as ConnectionOptions)
      )
      await adapter.connect()

      let auditRef: string | null = null
      let verdict: AssertVerdict
      try {
        const blacklistManager = new BlacklistManager(config)
        const blacklistValidator = new BlacklistValidator(blacklistManager)
        const executor = new QueryExecutor(
          adapter,
          config.permission,
          blacklistValidator,
          config,
          options as { config?: string }
        )

        const engine = mapSystemToEngine(config.connection.system)
        const dirs = resolveSnippetDirs(process.cwd())
        const snippets = await loadSnippets(dirs)
        const resolveSql = (q: string) =>
          q.startsWith('@') ? resolveByName(snippets, q.slice(1), engine).query.sqlBody : q

        const result: QueryResult<Record<string, unknown>> = await executor.execute(
          resolveSql(query),
          { autoLimit: true }
        )

        const checks: AssertCheck[] = []
        if (options.expect)
          checks.push(evaluateExpect(parseExpect(options.expect as string), result))
        if (options.vs) {
          const other = await executor.execute(resolveSql(options.vs as string), {
            autoLimit: true,
          })
          checks.push(compareVs(result, other, (options.compare as 'rows' | 'value') ?? 'value'))
        }
        if (options.against) {
          const baseline = await readSnapshot(options.against as string)
          const current = buildFingerprint(result, {
            query: resolveSql(query),
            engine: config.connection.system as SnapshotEngine,
          })
          checks.push(...compareAgainst(current, baseline, options.tolerance as number))
        }

        verdict = { pass: checks.every((c) => c.pass), checks }
        auditRef = await writeAuditEntry(config, 'assert', options as { config?: string }, {
          success: verdict.pass,
          sql: query,
        })
      } finally {
        await adapter.disconnect()
      }

      let verificationArtifactPath: string | undefined
      if (options.writeVerificationArtifact === true && verificationSubject) {
        try {
          const artifact = buildAssertVerificationArtifact({
            verdict,
            subject: verificationSubject,
            summary: options.verificationSummary as string | undefined,
            argv: process.argv,
            auditRef,
          })
          verificationArtifactPath = await writeVerificationArtifact(process.cwd(), artifact)
        } catch (e) {
          // Spec §9: a local write failure must not hide or flip the assertion verdict.
          console.error(`Failed to write verification artifact: ${(e as Error).message}`)
        }
      }

      let evidenceReceiptPath: string | undefined
      if (typeof options.evidenceReceipt === 'string') {
        try {
          const receipt = buildEvidenceReceipt({
            command: redactArgv(process.argv),
            context: await buildEvidenceReceiptContext(config, process.cwd()),
            auditRef,
            verificationArtifactRef: verificationArtifactPath
              ? basename(verificationArtifactPath)
              : null,
            verdict,
          })
          evidenceReceiptPath = await writeEvidenceReceipt(
            process.cwd(),
            options.evidenceReceipt,
            receipt
          )
        } catch {
          console.error('Failed to write evidence receipt')
          process.exit(1)
        }
      }

      if (options.format === 'json') {
        console.log(
          JSON.stringify(
            {
              ...verdict,
              ...(verificationArtifactPath ? { verificationArtifactPath } : {}),
              ...(evidenceReceiptPath ? { evidenceReceiptPath } : {}),
            },
            null,
            2
          )
        )
      } else {
        for (const c of verdict.checks) {
          console.log(
            `${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  expected=${c.expected} actual=${c.actual}`
          )
        }
        console.log(`\nVerdict: ${verdict.pass ? 'PASS' : 'FAIL'}`)
        if (verificationArtifactPath) {
          console.log(`Verification artifact: ${verificationArtifactPath}`)
        }
        if (evidenceReceiptPath) console.log(`Evidence receipt: ${evidenceReceiptPath}`)
      }
      process.exit(verdict.pass || options.fail === false ? 0 : 1)
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
        if (error instanceof ConnectionError)
          error.hints.forEach((h) => console.error(`   Hint: ${h}`))
      }
      process.exit(1)
    }
  })

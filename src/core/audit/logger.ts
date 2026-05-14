/**
 * AuditLogger — append-only JSONL writer with rotation + fail-soft semantics.
 *
 * Decisions implemented (see 21-CONTEXT.md):
 * - D-01: lives under src/core/audit/
 * - D-02: class instance, one per process; stateful (counters, sticky lastError)
 * - D-03: async write(); awaited by callers (engines in Phase 23)
 * - D-04: SessionIdService injected via constructor
 * - D-05/06/07: AuditLockManager injected (or constructed) with per-file lockfile
 * - D-08: appendFile (O_APPEND); no flush-to-disk syscall; one entry = one line + \n
 * - D-09/10/11: rotation = rename to .1, single segment, default 10MB / 1000
 * - D-12: lazy mkdir on first successful write
 * - D-13: wired indirectly through SessionIdService
 * - D-14: 'default' for unnamed/V1
 * - D-15: storagePath resolved by caller (config-binding.ts:64-67)
 * - D-16: once-per-process stderr warning; subsequent failures update sticky lastError silently
 */
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { AuditLockManager } from './lock'
import type { SessionIdService } from './session-id'
import { rotate, shouldRotate } from './rotation'

export interface AuditLoggerOptions {
  /** Resolved storage root (NOT including .dbcli/). Audit dir is `<storagePath>/.dbcli/audit/`. */
  storagePath: string
  /** Connection name. V1 / unnamed connections pass 'default' (D-14). */
  connectionName: string
  /** From config.audit.enabled. When false, write() short-circuits and never touches disk. */
  enabled: boolean
  /** From config.audit.rotation. */
  rotation: { maxBytes: number; maxEntries: number }
  /** Constructor-injected (D-04). Provides session_id for every entry. */
  sessionIdService: SessionIdService
  /** Test seam — defaults to a new AuditLockManager(auditFilePath). */
  lockManager?: AuditLockManager
}

export type AuditWriteResult =
  | { skipped: 'disabled' }
  | { skipped: 'lock-budget-exhausted' }
  | { skipped: 'write-failed'; error: string }
  | { success: true; rotated: boolean }

export interface AuditHealthReport {
  enabled: boolean
  writerInitialized: boolean
  currentFile: string
  currentSizeBytes: number
  currentEntryCount: number
  rotationUsage: {
    bytes: { current: number; max: number; pct: number }
    entries: { current: number; max: number; pct: number }
  }
  lock: { state: 'held' | 'free'; heldByPid?: number }
  lastWrite: { ts: string; success: boolean; error?: string } | null
  lastError: { ts: string; message: string } | null
  sessionId: string | null
  rotation: { lastRotatedAt?: string; previousFile?: string }
}

const WARN_PREFIX = '[dbcli audit]'

export class AuditLogger {
  private readonly auditDir: string
  private readonly auditFilePath: string
  private readonly previousFilePath: string
  private readonly enabled: boolean
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly sessionIdService: SessionIdService
  private readonly lockManager: AuditLockManager

  private writerInitialized = false
  private currentSizeBytes = 0
  private currentEntryCount = 0
  private lastWrite: { ts: string; success: boolean; error?: string } | null = null
  private lastError: { ts: string; message: string } | null = null
  private warnedOnceThisProcess = false
  private cachedSessionId: string | null = null
  private lastRotatedAt: string | undefined
  private lastRotatedPrevious: string | undefined
  private writeChain: Promise<void> = Promise.resolve()

  constructor(opts: AuditLoggerOptions) {
    this.enabled = opts.enabled
    this.maxBytes = opts.rotation.maxBytes
    this.maxEntries = opts.rotation.maxEntries
    this.auditDir = join(opts.storagePath, '.dbcli', 'audit')
    this.auditFilePath = join(this.auditDir, `${opts.connectionName}.jsonl`)
    this.previousFilePath = `${this.auditFilePath}.1`
    this.sessionIdService = opts.sessionIdService
    this.lockManager = opts.lockManager ?? new AuditLockManager(this.auditFilePath)
  }

  async write(entry: Record<string, unknown>): Promise<AuditWriteResult> {
    const writeOp = this.writeChain.then(() => this.writeInternal(entry))
    this.writeChain = writeOp.then(
      () => undefined,
      () => undefined
    )
    return writeOp
  }

  private async writeInternal(entry: Record<string, unknown>): Promise<AuditWriteResult> {
    // D-01 / CONFIG-02 short-circuit; never touches disk.
    if (!this.enabled) {
      return { skipped: 'disabled' }
    }

    try {
      // D-04 / AUDIT-02 / AUDIT-03: resolve session id (cached after first call).
      const sessionId = await this.sessionIdService.resolve()
      this.cachedSessionId = sessionId

      // D-12: lazy mkdir on first successful path.
      await mkdir(this.auditDir, { recursive: true })

      // Re-sync counters from disk on first run (covers process restart with existing file).
      if (!this.writerInitialized) {
        await this.syncCountersFromDisk()
        this.writerInitialized = true
      }

      // Place session_id AFTER the spread so a caller-supplied session_id can
      // never override the resolved id (T-21-16 tampering mitigation).
      const enriched = { ...entry, session_id: sessionId }
      const line = JSON.stringify(enriched) + '\n'
      const lineBytes = Buffer.byteLength(line, 'utf8')

      // D-05/06/07: critical section — rotation check + append under lock.
      const lockResult = await this.lockManager.withLock(async (): Promise<{ rotated: boolean }> => {
        let rotated = false
        if (
          shouldRotate(
            { currentSizeBytes: this.currentSizeBytes, currentEntryCount: this.currentEntryCount },
            { maxBytes: this.maxBytes, maxEntries: this.maxEntries },
            lineBytes
          )
        ) {
          await rotate(this.auditFilePath, this.previousFilePath)
          this.lastRotatedAt = new Date().toISOString()
          this.lastRotatedPrevious = this.previousFilePath
          this.currentSizeBytes = 0
          this.currentEntryCount = 0
          rotated = true
        }
        // D-08: O_APPEND, no flush-to-disk syscall, single line + \n.
        await appendFile(this.auditFilePath, line, { encoding: 'utf8' })
        this.currentSizeBytes += lineBytes
        this.currentEntryCount += 1
        return { rotated }
      }, 'audit-write')

      if (lockResult !== null && typeof lockResult === 'object' && 'skipped' in lockResult) {
        // Lock budget exhausted — D-07 fail-soft.
        this.handleFailure('lock-budget-exhausted')
        return { skipped: 'lock-budget-exhausted' }
      }

      const ts = new Date().toISOString()
      this.lastWrite = { ts, success: true }
      return { success: true, rotated: lockResult.rotated }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.handleFailure(message)
      return { skipped: 'write-failed', error: message }
    }
  }

  getHealth(): AuditHealthReport {
    return {
      enabled: this.enabled,
      writerInitialized: this.writerInitialized,
      currentFile: this.auditFilePath,
      currentSizeBytes: this.currentSizeBytes,
      currentEntryCount: this.currentEntryCount,
      rotationUsage: {
        bytes: {
          current: this.currentSizeBytes,
          max: this.maxBytes,
          pct: this.maxBytes > 0 ? (this.currentSizeBytes / this.maxBytes) * 100 : 0,
        },
        entries: {
          current: this.currentEntryCount,
          max: this.maxEntries,
          pct: this.maxEntries > 0 ? (this.currentEntryCount / this.maxEntries) * 100 : 0,
        },
      },
      lock: { state: this.lockManager.isLockHeld() ? 'held' : 'free' },
      lastWrite: this.lastWrite,
      lastError: this.lastError,
      sessionId: this.cachedSessionId,
      rotation: {
        lastRotatedAt: this.lastRotatedAt,
        previousFile: this.lastRotatedPrevious,
      },
    }
  }

  private async syncCountersFromDisk(): Promise<void> {
    try {
      const s = await stat(this.auditFilePath)
      this.currentSizeBytes = s.size
      const raw = await readFile(this.auditFilePath, 'utf8')
      this.currentEntryCount = raw.split('\n').filter(Boolean).length
    } catch {
      // File doesn't exist yet — counters stay at 0.
      this.currentSizeBytes = 0
      this.currentEntryCount = 0
    }
  }

  private handleFailure(message: string): void {
    const ts = new Date().toISOString()
    this.lastError = { ts, message }
    this.lastWrite = { ts, success: false, error: message }
    if (!this.warnedOnceThisProcess) {
      process.stderr.write(
        `${WARN_PREFIX} warning: audit write failed (${message}); subsequent failures suppressed this process.\n`
      )
      this.warnedOnceThisProcess = true
    }
  }
}

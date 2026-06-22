// src/core/verify/registry.ts
import type { Command } from 'commander'
import type { AdapterFactory } from '@/adapters'
import type { configModule } from '@/core/config'
import type { VerificationArtifact } from '@/core/verification'

/** Subject classification for a built-in verify scenario (auditable, never user-extended). */
export type VerifyScenarioSubjectKind = 'table' | 'migration' | 'rollback'

/** Fields every scenario input must expose so the generic lifecycle can drive flow. */
export interface VerifyScenarioInputBase {
  table: string
  afterWrite: boolean
  format: 'table' | 'json'
}

/** Resolved adapter/config context handed to a scenario's runner builder. */
export interface RealRunnerContext {
  adapter: ReturnType<typeof AdapterFactory.createSqlAdapter>
  config: Awaited<ReturnType<typeof configModule.read>>
  options: { config?: string }
  /** The declared --table; guards require the write/DDL target to match it. */
  targetTable: string
}

/**
 * A built-in verify scenario. Metadata is generic and auditable; scenario-specific
 * behavior (options, normalization, runners, renderers, readiness rules) lives in the
 * definition. The command layer owns CLI execution mechanics and treats Runners/
 * Preflight/AfterWrite opaquely.
 *
 * Members use method syntax deliberately: it makes concrete instantiations assignable
 * to the type-erased `AnyVerifyScenario` used by the registry array.
 */
export interface VerifyScenarioDefinition<
  Input extends VerifyScenarioInputBase,
  Runners,
  Preflight,
  AfterWrite,
> {
  name: string
  description: string
  subjectKind: VerifyScenarioSubjectKind
  /** Attach the scenario's Commander options to its subcommand. */
  configureOptions(command: Command): Command
  /** Validate + normalize raw CLI options; throws VerifyInputError on bad input. */
  normalize(options: Record<string, unknown>): Input
  /** Build the production runners that touch config / adapter / analyzer. */
  createRunners(context: RealRunnerContext, input: Input): Runners
  runPreflight(input: Input, runners: Runners): Promise<Preflight>
  runAfterWrite(input: Input, runners: Runners): Promise<AfterWrite>
  /** Render preflight output for the requested format (table or pretty JSON string). */
  renderPreflight(result: Preflight, format: 'table' | 'json'): string
  /** The artifact the lifecycle should persist in after-write mode. */
  artifactOf(result: AfterWrite): VerificationArtifact
  /** The after-write JSON object (the lifecycle merges artifactError + stringifies). */
  afterWriteJson(result: AfterWrite, artifactPath?: string): unknown
  /** The after-write table rendering. */
  renderAfterWriteTable(result: AfterWrite, artifactPath?: string): string
  /** Preflight exits 0 only when this returns true. */
  isPreflightReady(result: Preflight): boolean
  /** After-write exits 0 only when this returns true (artifactError is the persist failure, if any). */
  isAfterWriteVerified(result: AfterWrite, artifactError?: string): boolean
}

/** Type-erased scenario used to hold the heterogeneous registry array. */
export type AnyVerifyScenario = VerifyScenarioDefinition<
  VerifyScenarioInputBase,
  unknown,
  unknown,
  unknown
>

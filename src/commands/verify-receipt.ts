import { basename } from 'node:path'
import type { RuntimeDbcliConfig } from '@/core/config'
import type { VerificationArtifact } from '@/core/verification'
import { buildEvidenceReceipt, writeEvidenceReceipt } from '@/core/evidence-receipt'
import { buildEvidenceReceiptContext } from '@/commands/evidence-receipt-context'
import { redactArgv } from '@/utils/redaction'

export interface WriteVerifyEvidenceReceiptInput {
  workspaceRoot: string
  scenarioName: string
  config: RuntimeDbcliConfig
  artifact: VerificationArtifact
  artifactPath?: string
  outputPath: string
  argv: string[]
}

export type WriteVerifyEvidenceReceiptResult = { path: string } | { error: string }

/**
 * Writes the optional receipt only after the scenario's artifact outcome is known.
 * All unsafe details collapse to a stable error because this result is printed by CLI.
 */
export async function writeVerifyEvidenceReceipt(
  input: WriteVerifyEvidenceReceiptInput
): Promise<WriteVerifyEvidenceReceiptResult> {
  const auditRefs = [
    ...new Set(
      input.artifact.evidence.flatMap((entry) => (entry.auditRef ? [entry.auditRef] : []))
    ),
  ]
  if (auditRefs.length > 1) {
    return {
      error: `Evidence receipt unsupported for built-in verify scenario ${input.scenarioName}`,
    }
  }
  try {
    const receipt = buildEvidenceReceipt({
      operation: 'verify',
      command: redactArgv(input.argv),
      context: await buildEvidenceReceiptContext(input.config, input.workspaceRoot),
      auditRef: auditRefs[0] ?? null,
      verificationArtifactRef: input.artifactPath ? basename(input.artifactPath) : null,
      verificationStatus: input.artifact.status,
      verificationArtifactPersisted: input.artifactPath !== undefined,
    })
    return { path: await writeEvidenceReceipt(input.workspaceRoot, input.outputPath, receipt) }
  } catch {
    return { error: 'Failed to write evidence receipt' }
  }
}

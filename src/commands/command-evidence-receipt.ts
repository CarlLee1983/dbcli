import type { RuntimeDbcliConfig } from '@/core/config'
import { configModule } from '@/core/config'
import { getGlobalCorrelationId } from '@/core/correlation-id'
import {
  buildCommandEvidenceReceipt,
  type CommandEvidenceReceiptOperation,
  writeEvidenceReceipt,
} from '@/core/evidence-receipt'
import { buildEvidenceReceiptContext } from '@/commands/evidence-receipt-context'
import { resolveConfigPath } from '@/utils/config-path'
import type { Command } from 'commander'

export type CommandEvidenceReceiptResult =
  | { path: string }
  | { error: 'Failed to write evidence receipt' }

/** Writes optional bounded provenance after a command's outcome is already known. */
export async function writeCommandEvidenceReceipt(input: {
  workspaceRoot: string
  outputPath: string
  config: RuntimeDbcliConfig
  operation: CommandEvidenceReceiptOperation
  outcome: 'succeeded' | 'failed'
  auditRef?: string | null
}): Promise<CommandEvidenceReceiptResult> {
  try {
    const receipt = buildCommandEvidenceReceipt({
      operation: input.operation,
      outcome: input.outcome,
      context: await buildEvidenceReceiptContext(input.config, input.workspaceRoot),
      correlationId: getGlobalCorrelationId(),
      auditRef: input.auditRef,
    })
    return { path: await writeEvidenceReceipt(input.workspaceRoot, input.outputPath, receipt) }
  } catch {
    return { error: 'Failed to write evidence receipt' }
  }
}

/** Adds the shared opt-in receipt behavior to commands whose result is already complete. */
export function attachCommandEvidenceReceipt(
  command: Command,
  operation: CommandEvidenceReceiptOperation
): void {
  command
    .option('--evidence-receipt <path>', 'Write a safe provenance receipt after the result')
    .hook('postAction', async (_thisCommand, actionCommand) => {
      try {
        const outputPath = actionCommand.opts<Record<string, unknown>>().evidenceReceipt
        if (typeof outputPath !== 'string') return
        const config = await configModule.read(resolveConfigPath(actionCommand))
        const result = await writeCommandEvidenceReceipt({
          workspaceRoot: process.cwd(),
          outputPath,
          config,
          operation,
          outcome: process.exitCode === 1 ? 'failed' : 'succeeded',
        })
        if ('error' in result) console.error(result.error)
        else console.error(`Evidence receipt: ${result.path}`)
      } catch {
        console.error('Failed to write evidence receipt')
      }
    })
}

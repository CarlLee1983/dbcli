import type { Command } from 'commander'
import { initCommand } from './commands/init'
import { listCommand } from './commands/list'
import { schemaCommand } from './commands/schema'
import { queryCommand } from './commands/query'
import { planCommand } from './commands/plan'
import { qCommand } from './commands/q'
import { queriesCommand } from './commands/queries'
import { insertCommand } from './commands/insert'
import { updateCommand } from './commands/update'
import { deleteCommand } from './commands/delete'
import { exportCommand } from './commands/export'
import { registerSkillCommand } from './commands/skill'
import { registerSkillTasksCommand } from './commands/skill-tasks'
import { blacklistCommand } from './commands/blacklist'
import { checkCommand } from './commands/check'
import { diffCommand } from './commands/diff'
import { statusCommand } from './commands/status'
import { inspectCommand } from './commands/inspect'
import { reportCommand } from './commands/report'
import { guideCommand } from './commands/guide'
import { registerMissingIndexCommand } from './commands/guide-missing-index'
import { explainCommand } from './commands/explain'
import { lintCommand } from './commands/lint'
import { snapshotCommand } from './commands/snapshot'
import { assertCommand } from './commands/assert'
import { verificationCommand } from './commands/verification'
import { verifyCommand } from './commands/verify'
import { recoveryCommand } from './commands/recovery'
import { recoverCommand } from './commands/recover'
import { auditCommand } from './commands/audit'
import { doctorCommand } from './commands/doctor'
import { completionCommand } from './commands/completion'
import { upgradeCommand } from './commands/upgrade'
import { shellCommand } from './commands/shell'
import { migrateCommand } from './commands/migrate'
import { useCommand } from './commands/use'
import { proxyCommand } from './commands/proxy'
import { semanticCommand } from './commands/semantic'
import { designCommand } from './commands/design'
import { backfillCommand } from './commands/backfill'
import { evidenceCommand } from './commands/evidence'
import { contractCommand } from './commands/contracts'
import { impactCommand } from './commands/impact'
import {
  registerQueryCommand,
  registerPlanCommand,
  registerQCommand,
  registerInsertCommand,
  registerUpdateCommand,
  registerDeleteCommand,
  registerExportCommand,
} from './commands/inline-registrars'
import { createRootProgram } from './program-root'

export { normalizeLimitFlags } from './program-root'

/**
 * Build the dbcli Commander program with all commands registered.
 *
 * NOTE: command objects are module-level singletons shared across calls, so a
 * second buildProgram() re-parents them onto the newest program. Callers must
 * use the returned program immediately (parse it, or read its command tree) and
 * must NOT retain a previously returned program — its subcommands' .parent will
 * have been repointed. cli.ts builds once; shell.ts builds-and-discards.
 */
export function buildProgram(): Command {
  const program = createRootProgram()

  // Register commands
  program.addCommand(initCommand)
  program.addCommand(listCommand)
  program.addCommand(schemaCommand)

  // Register query command
  registerQueryCommand(program, queryCommand)

  // Register plan command
  registerPlanCommand(program, planCommand)

  // Register saved-query (q) command
  registerQCommand(program, qCommand)

  // Register insert command
  registerInsertCommand(program, insertCommand)

  // Register update command
  registerUpdateCommand(program, updateCommand)

  // Register delete command
  registerDeleteCommand(program, deleteCommand)

  // Register export command
  registerExportCommand(program, exportCommand)

  // Register skill command + skill tasks sub-tree
  const skillCmd = registerSkillCommand(program)
  registerSkillTasksCommand(skillCmd)

  // Register blacklist command
  program.addCommand(blacklistCommand)

  // Register check command
  program.addCommand(checkCommand)

  // Register diff command
  program.addCommand(diffCommand)

  // Register status command
  program.addCommand(statusCommand)
  program.addCommand(inspectCommand)
  program.addCommand(reportCommand)
  program.addCommand(guideCommand)
  registerMissingIndexCommand(guideCommand)
  program.addCommand(recoveryCommand)
  program.addCommand(recoverCommand)
  program.addCommand(auditCommand)
  program.addCommand(doctorCommand)
  program.addCommand(completionCommand)
  program.addCommand(upgradeCommand)
  program.addCommand(shellCommand)
  program.addCommand(migrateCommand)
  program.addCommand(useCommand)
  program.addCommand(queriesCommand)
  program.addCommand(explainCommand)
  program.addCommand(lintCommand)
  program.addCommand(snapshotCommand)
  program.addCommand(assertCommand)
  program.addCommand(verificationCommand)
  program.addCommand(verifyCommand)
  program.addCommand(proxyCommand)
  program.addCommand(semanticCommand)
  program.addCommand(designCommand)
  program.addCommand(backfillCommand)
  program.addCommand(evidenceCommand)
  program.addCommand(contractCommand)
  program.addCommand(impactCommand)

  return program
}

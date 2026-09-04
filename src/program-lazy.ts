import type { Command } from 'commander'
import { createRootProgram } from './program-root'

/**
 * Contract between the two registration paths.
 *
 * buildProgram() (in ./program) stays eager — check-cli-contract.ts, the
 * completion tree and a dozen tests walk the whole command tree in-process
 * and must keep seeing it. buildProgramFor(argv) registers only the command
 * argv actually names, so a real CLI invocation stops paying for the other
 * ~40 command modules.
 *
 * Nothing in this file may statically import ./program or any ./commands/*
 * module — that static edge is exactly what would make the laziness here a
 * no-op, since Bun/Node resolve the whole static import graph up front.
 */
export const COMMAND_LOADERS: Record<string, () => Promise<(program: Command) => void>> = {
  init: async () => {
    const { initCommand } = await import('./commands/init')
    return (program) => {
      program.addCommand(initCommand)
    }
  },
  list: async () => {
    const { listCommand } = await import('./commands/list')
    return (program) => {
      program.addCommand(listCommand)
    }
  },
  schema: async () => {
    const { schemaCommand } = await import('./commands/schema')
    return (program) => {
      program.addCommand(schemaCommand)
    }
  },
  query: async () => {
    const { queryCommand } = await import('./commands/query')
    const { registerQueryCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerQueryCommand(program, queryCommand)
    }
  },
  plan: async () => {
    const { planCommand } = await import('./commands/plan')
    const { registerPlanCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerPlanCommand(program, planCommand)
    }
  },
  q: async () => {
    const { qCommand } = await import('./commands/q')
    const { registerQCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerQCommand(program, qCommand)
    }
  },
  insert: async () => {
    const { insertCommand } = await import('./commands/insert')
    const { registerInsertCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerInsertCommand(program, insertCommand)
    }
  },
  update: async () => {
    const { updateCommand } = await import('./commands/update')
    const { registerUpdateCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerUpdateCommand(program, updateCommand)
    }
  },
  delete: async () => {
    const { deleteCommand } = await import('./commands/delete')
    const { registerDeleteCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerDeleteCommand(program, deleteCommand)
    }
  },
  export: async () => {
    const { exportCommand } = await import('./commands/export')
    const { registerExportCommand } = await import('./commands/inline-registrars')
    return (program) => {
      registerExportCommand(program, exportCommand)
    }
  },
  skill: async () => {
    const { registerSkillCommand } = await import('./commands/skill')
    const { registerSkillTasksCommand } = await import('./commands/skill-tasks')
    return (program) => {
      registerSkillTasksCommand(registerSkillCommand(program))
    }
  },
  blacklist: async () => {
    const { blacklistCommand } = await import('./commands/blacklist')
    return (program) => {
      program.addCommand(blacklistCommand)
    }
  },
  check: async () => {
    const { checkCommand } = await import('./commands/check')
    return (program) => {
      program.addCommand(checkCommand)
    }
  },
  diff: async () => {
    const { diffCommand } = await import('./commands/diff')
    return (program) => {
      program.addCommand(diffCommand)
    }
  },
  status: async () => {
    const { statusCommand } = await import('./commands/status')
    return (program) => {
      program.addCommand(statusCommand)
    }
  },
  inspect: async () => {
    const { inspectCommand } = await import('./commands/inspect')
    return (program) => {
      program.addCommand(inspectCommand)
    }
  },
  report: async () => {
    const { reportCommand } = await import('./commands/report')
    return (program) => {
      program.addCommand(reportCommand)
    }
  },
  guide: async () => {
    const { guideCommand } = await import('./commands/guide')
    const { registerMissingIndexCommand } = await import('./commands/guide-missing-index')
    return (program) => {
      program.addCommand(guideCommand)
      registerMissingIndexCommand(guideCommand)
    }
  },
  recovery: async () => {
    const { recoveryCommand } = await import('./commands/recovery')
    return (program) => {
      program.addCommand(recoveryCommand)
    }
  },
  recover: async () => {
    const { recoverCommand } = await import('./commands/recover')
    return (program) => {
      program.addCommand(recoverCommand)
    }
  },
  audit: async () => {
    const { auditCommand } = await import('./commands/audit')
    return (program) => {
      program.addCommand(auditCommand)
    }
  },
  doctor: async () => {
    const { doctorCommand } = await import('./commands/doctor')
    return (program) => {
      program.addCommand(doctorCommand)
    }
  },
  completion: async () => {
    const { completionCommand } = await import('./commands/completion')
    return (program) => {
      program.addCommand(completionCommand)
    }
  },
  upgrade: async () => {
    const { upgradeCommand } = await import('./commands/upgrade')
    return (program) => {
      program.addCommand(upgradeCommand)
    }
  },
  shell: async () => {
    const { shellCommand } = await import('./commands/shell')
    return (program) => {
      program.addCommand(shellCommand)
    }
  },
  migrate: async () => {
    const { migrateCommand } = await import('./commands/migrate')
    return (program) => {
      program.addCommand(migrateCommand)
    }
  },
  password: async () => {
    const { passwordCommand } = await import('./commands/credential')
    return (program: Command) => {
      program.addCommand(passwordCommand)
    }
  },
  use: async () => {
    const { useCommand } = await import('./commands/use')
    return (program) => {
      program.addCommand(useCommand)
    }
  },
  queries: async () => {
    const { queriesCommand } = await import('./commands/queries')
    return (program) => {
      program.addCommand(queriesCommand)
    }
  },
  explain: async () => {
    const { explainCommand } = await import('./commands/explain')
    return (program) => {
      program.addCommand(explainCommand)
    }
  },
  lint: async () => {
    const { lintCommand } = await import('./commands/lint')
    return (program) => {
      program.addCommand(lintCommand)
    }
  },
  snapshot: async () => {
    const { snapshotCommand } = await import('./commands/snapshot')
    return (program) => {
      program.addCommand(snapshotCommand)
    }
  },
  assert: async () => {
    const { assertCommand } = await import('./commands/assert')
    return (program) => {
      program.addCommand(assertCommand)
    }
  },
  verification: async () => {
    const { verificationCommand } = await import('./commands/verification')
    return (program) => {
      program.addCommand(verificationCommand)
    }
  },
  verify: async () => {
    const { verifyCommand } = await import('./commands/verify')
    return (program) => {
      program.addCommand(verifyCommand)
    }
  },
  proxy: async () => {
    const { proxyCommand } = await import('./commands/proxy')
    return (program) => {
      program.addCommand(proxyCommand)
    }
  },
  semantic: async () => {
    const { semanticCommand } = await import('./commands/semantic')
    return (program) => {
      program.addCommand(semanticCommand)
    }
  },
  design: async () => {
    const { designCommand } = await import('./commands/design')
    return (program) => {
      program.addCommand(designCommand)
    }
  },
  backfill: async () => {
    const { backfillCommand } = await import('./commands/backfill')
    return (program) => {
      program.addCommand(backfillCommand)
    }
  },
  evidence: async () => {
    const { evidenceCommand } = await import('./commands/evidence')
    return (program) => {
      program.addCommand(evidenceCommand)
    }
  },
  contract: async () => {
    const { contractCommand } = await import('./commands/contracts')
    return (program) => {
      program.addCommand(contractCommand)
    }
  },
  impact: async () => {
    const { impactCommand } = await import('./commands/impact')
    return (program) => {
      program.addCommand(impactCommand)
    }
  },
  capabilities: async () => {
    const { capabilitiesCommand } = await import('./commands/capabilities')
    return (program) => {
      program.addCommand(capabilitiesCommand)
    }
  },
}

export const COMMAND_NAMES: readonly string[] = Object.keys(COMMAND_LOADERS)

/**
 * Root option flags, split by how they consume the token that follows.
 *
 * Both spellings are collected even though no root short option takes a value
 * today: were one added, reading only the long form would make `dbcli -c query`
 * dispatch to the `query` command instead of treating `query` as -c's value —
 * a silent misdispatch, not merely a lost optimization.
 *
 * Optional-value options (`--foo [bar]`) are separated out rather than folded
 * in, because Commander only swallows the next token when it doesn't look like
 * an option. Guessing either way misreads some argv, so their presence sends
 * the whole invocation to the eager path instead.
 */
function rootOptionFlags(options: Command['options']): {
  consumesNext: ReadonlySet<string>
  ambiguous: ReadonlySet<string>
} {
  const consumesNext = new Set<string>()
  const ambiguous = new Set<string>()
  for (const option of options) {
    const target = option.required ? consumesNext : option.optional ? ambiguous : undefined
    if (!target) continue
    if (option.long) target.add(option.long)
    if (option.short) target.add(option.short)
  }
  return { consumesNext, ambiguous }
}

/**
 * Find the first argv token that names a command, applying the same placement
 * rules Commander itself uses: `--` ends option/command parsing, any
 * `-`-prefixed token is an option, and a root option taking a required value
 * additionally consumes the token after it (unless given as `--opt=value`,
 * which is self-contained).
 *
 * Returning undefined costs only the optimization — the caller falls back to
 * the eager tree and the CLI behaves exactly as before. Returning the wrong
 * name would dispatch the wrong command, so every uncertain shape returns
 * undefined.
 */
function findCommandName(argv: readonly string[], options: Command['options']): string | undefined {
  const { consumesNext, ambiguous } = rootOptionFlags(options)
  const rawArgs = argv.slice(2)
  for (let index = 0; index < rawArgs.length; index++) {
    const token = rawArgs[index]!
    if (token === '--') return undefined
    if (token.startsWith('-')) {
      const flag = token.split('=', 1)[0]!
      if (ambiguous.has(flag)) return undefined
      if (!token.includes('=') && consumesNext.has(flag)) index++
      continue
    }
    return token
  }
  return undefined
}

/**
 * Build a program containing only the command argv names, or the full eager
 * tree when argv doesn't unambiguously name exactly one known command
 * (no command, `--help`, an unknown name, or anything after a bare `--`).
 */
export async function buildProgramFor(argv: readonly string[]): Promise<Command> {
  const program = createRootProgram()
  const name = findCommandName(argv, program.options)
  const loader = name === undefined ? undefined : COMMAND_LOADERS[name]
  if (loader) {
    const register = await loader()
    register(program)
    return program
  }

  const { buildProgram } = await import('./program')
  return buildProgram()
}

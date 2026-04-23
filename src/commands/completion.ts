import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { join } from 'path'
import { homedir } from 'os'

export interface CommandInfo {
  name: string
  options: string[]
}

function extractCommands(program: Command): CommandInfo[] {
  return program.commands.map((cmd) => ({
    name: cmd.name(),
    options: cmd.options.map((o) => o.long ?? o.short ?? '').filter(Boolean),
  }))
}

function extractGlobalOptions(program: Command): string[] {
  return program.options.map((o) => o.long ?? o.short ?? '').filter(Boolean)
}

export function generateBashCompletion(commands: CommandInfo[], globalOptions: string[]): string {
  const cmdNames = commands.map((c) => c.name).join(' ')
  const globalOpts = globalOptions.join(' ')

  const caseEntries = commands
    .map(
      (c) =>
        `    ${c.name})\n      COMPREPLY=( $(compgen -W "${c.options.join(' ')}" -- "\${cur}") )\n      ;;`
    )
    .join('\n')

  return `#!/bin/bash
# dbcli bash completion — auto-generated, do not edit
_dbcli_completions() {
  local cur prev commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${cmdNames}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands} ${globalOpts}" -- "\${cur}") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
${caseEntries}
    *)
      COMPREPLY=( $(compgen -W "${globalOpts}" -- "\${cur}") )
      ;;
  esac
}
complete -F _dbcli_completions dbcli
`
}

export function generateZshCompletion(commands: CommandInfo[], globalOptions: string[]): string {
  const cmdLines = commands.map((c) => `    '${c.name}:${c.name} command'`).join('\n')

  const subcmdCases = commands
    .map((c) => {
      const opts = c.options.map((o) => `'${o}[${o}]'`).join(' ')
      return `  ${c.name})\n    _arguments ${opts}\n    ;;`
    })
    .join('\n')

  const globalOpts = globalOptions.map((o) => `'${o}[${o}]'`).join(' ')

  return `#compdef dbcli
# dbcli zsh completion — auto-generated, do not edit
_dbcli() {
  local -a commands
  commands=(
${cmdLines}
  )

  _arguments -C \\
    ${globalOpts} \\
    '1:command:->cmd' \\
    '*::arg:->args'

  case "\$state" in
  cmd)
    _describe 'command' commands
    ;;
  args)
    case "\$words[1]" in
${subcmdCases}
    esac
    ;;
  esac
}
_dbcli
`
}

export function generateFishCompletion(commands: CommandInfo[], globalOptions: string[]): string {
  const lines = ['# dbcli fish completion — auto-generated, do not edit', '']

  for (const opt of globalOptions) {
    const longName = opt.replace(/^--/, '')
    lines.push(`complete -c dbcli -n '__fish_use_subcommand' -l ${longName} -d '${opt}'`)
  }

  for (const cmd of commands) {
    lines.push(
      `complete -c dbcli -n '__fish_use_subcommand' -a ${cmd.name} -d '${cmd.name} command'`
    )
  }

  for (const cmd of commands) {
    for (const opt of cmd.options) {
      const longName = opt.replace(/^--/, '')
      lines.push(
        `complete -c dbcli -n '__fish_seen_subcommand_from ${cmd.name}' -l ${longName} -d '${opt}'`
      )
    }
  }

  return lines.join('\n') + '\n'
}

export function getInstallPath(shell: string): string {
  const home = homedir()
  switch (shell) {
    case 'bash':
      return join(home, '.bashrc')
    case 'zsh':
      return join(home, '.zshrc')
    case 'fish':
      return join(home, '.config', 'fish', 'completions', 'dbcli.fish')
    default:
      throw new Error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish`)
  }
}

export function detectShell(): string {
  const shellEnv = process.env.SHELL ?? ''
  if (shellEnv.includes('zsh')) return 'zsh'
  if (shellEnv.includes('bash')) return 'bash'
  if (shellEnv.includes('fish')) return 'fish'
  return 'bash'
}

const MARKER_START = '# >>> dbcli completion >>>'
const MARKER_END = '# <<< dbcli completion <<<'

async function installCompletion(shell: string, script: string): Promise<void> {
  const targetPath = getInstallPath(shell)

  if (shell === 'fish') {
    const dir = join(homedir(), '.config', 'fish', 'completions')
    await Bun.$`mkdir -p ${dir}`.quiet()
    await Bun.file(targetPath).write(script)
    console.log(colors.success(`✓ Fish completion installed to ${targetPath}`))
    return
  }

  const file = Bun.file(targetPath)
  let content = ''
  if (await file.exists()) {
    content = await file.text()
  }

  const markerRegex = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, 'g')
  content = content.replace(markerRegex, '')

  const block = `\n${MARKER_START}\neval "$(dbcli completion ${shell})"\n${MARKER_END}\n`
  content = content.trimEnd() + '\n' + block

  await Bun.file(targetPath).write(content)
  console.log(colors.success(`✓ Completion installed to ${targetPath}`))
  console.log(colors.info(`  Run: source ${targetPath}`))
}

export const completionCommand = new Command('completion')
  .description('Generate shell completion scripts (bash, zsh, fish)')
  .argument('[shell]', 'Shell type: bash, zsh, fish')
  .option('--install [shell]', 'Auto-install completion to shell rc file')
  .action(async (shellArg: string | undefined, options: { install?: string | boolean }) => {
    const parentProgram = completionCommand.parent
    if (!parentProgram) {
      console.error(colors.error('Error: completion command must be registered to a program'))
      process.exit(1)
    }

    const commands = extractCommands(parentProgram)
    const globalOptions = extractGlobalOptions(parentProgram)

    if (options.install !== undefined) {
      const shell =
        typeof options.install === 'string' ? options.install : (shellArg ?? detectShell())
      const generators: Record<string, typeof generateBashCompletion> = {
        bash: generateBashCompletion,
        zsh: generateZshCompletion,
        fish: generateFishCompletion,
      }
      const generate = generators[shell]
      if (!generate) {
        console.error(colors.error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish`))
        process.exit(1)
      }
      const script = generate(commands, globalOptions)
      await installCompletion(shell, script)
      return
    }

    const shell = shellArg ?? detectShell()
    const generators: Record<string, typeof generateBashCompletion> = {
      bash: generateBashCompletion,
      zsh: generateZshCompletion,
      fish: generateFishCompletion,
    }
    const generate = generators[shell]
    if (!generate) {
      console.error(colors.error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish`))
      process.exit(1)
    }
    process.stdout.write(generate(commands, globalOptions))
  })

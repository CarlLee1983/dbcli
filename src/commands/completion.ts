import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { join } from 'path'
import { homedir } from 'os'
import {
  buildCompletionTree,
  flattenCommandTree,
  type CompletionCommandNode,
} from '@/core/completion/command-tree'

function optionFlags(node: CompletionCommandNode): string[] {
  return node.options.map((o) => o.long ?? o.short).filter((x): x is string => Boolean(x))
}

function childNames(node: CompletionCommandNode): string[] {
  return node.children.map((c) => c.name)
}

export function generateBashCompletion(root: CompletionCommandNode): string {
  const entries = flattenCommandTree(root)
  const rootOpts = optionFlags(root).join(' ')

  const cmdArms = entries
    .filter((e) => e.node.children.length > 0)
    .map((e) => {
      const key = e.path.join(' ')
      const words = [...childNames(e.node), ...(e.path.length === 0 ? optionFlags(root) : [])].join(' ')
      return `    "${key}") COMPREPLY=( $(compgen -W "${words}" -- "$cur") ) ;;`
    })
    .join('\n')

  const optArms = entries
    .filter((e) => optionFlags(e.node).length > 0)
    .map((e) => {
      const key = e.path.join(' ')
      return `    "${key}") COMPREPLY=( $(compgen -W "${optionFlags(e.node).join(' ')}" -- "$cur") ) ;;`
    })
    .join('\n')

  return `#!/bin/bash
# dbcli bash completion — auto-generated, do not edit
_dbcli_completions() {
  local cur path w i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  path=""
  for (( i=1; i < COMP_CWORD; i++ )); do
    w="\${COMP_WORDS[i]}"
    [[ "$w" == -* ]] && continue
    if [[ -z "$path" ]]; then path="$w"; else path="$path $w"; fi
  done

  if [[ "$cur" == -* ]]; then
    case "$path" in
${optArms}
      *) COMPREPLY=( $(compgen -W "${rootOpts}" -- "$cur") ) ;;
    esac
    return 0
  fi

  case "$path" in
${cmdArms}
    *) COMPREPLY=( $(compgen -W "${rootOpts}" -- "$cur") ) ;;
  esac
}
complete -F _dbcli_completions dbcli
`
}

export function generateZshCompletion(root: CompletionCommandNode): string {
  const entries = flattenCommandTree(root)
  const rootOpts = optionFlags(root).join(' ')

  const cmdArms = entries
    .filter((e) => e.node.children.length > 0)
    .map((e) => {
      const key = e.path.join(' ')
      const words = [...childNames(e.node), ...(e.path.length === 0 ? optionFlags(root) : [])].join(' ')
      return `    "${key}") compadd -- ${words} ;;`
    })
    .join('\n')

  const optArms = entries
    .filter((e) => optionFlags(e.node).length > 0)
    .map((e) => {
      const key = e.path.join(' ')
      return `    "${key}") compadd -- ${optionFlags(e.node).join(' ')} ;;`
    })
    .join('\n')

  return `#compdef dbcli
# dbcli zsh completion — auto-generated, do not edit
_dbcli() {
  local path w i cur
  cur="\${words[CURRENT]}"
  path=""
  for (( i=2; i < CURRENT; i++ )); do
    w="\${words[i]}"
    [[ "$w" == -* ]] && continue
    if [[ -z "$path" ]]; then path="$w"; else path="$path $w"; fi
  done

  if [[ "$cur" == -* ]]; then
    case "$path" in
${optArms}
      *) compadd -- ${rootOpts} ;;
    esac
    return
  fi

  case "$path" in
${cmdArms}
    *) compadd -- ${rootOpts} ;;
  esac
}
_dbcli "$@"
`
}

export function generateFishCompletion(root: CompletionCommandNode): string {
  const entries = flattenCommandTree(root)
  const lines: string[] = [
    '# dbcli fish completion — auto-generated, do not edit',
    '',
    'function __fish_dbcli_path',
    '    set -l tokens (commandline -opc)',
    '    set -l path',
    '    for t in $tokens[2..-1]',
    "        string match -q -- '-*' $t; and continue",
    '        set path $path $t',
    '    end',
    "    test (string join ' ' $path) = (string join ' ' $argv)",
    'end',
    '',
  ]

  const sanitize = (s: string): string => s.replace(/'/g, '')

  for (const e of entries) {
    const cond = e.path.length === 0 ? '__fish_use_subcommand' : `__fish_dbcli_path ${e.path.join(' ')}`
    for (const child of e.node.children) {
      lines.push(
        `complete -c dbcli -n '${cond}' -a ${child.name} -d '${sanitize(child.description) || child.name}'`
      )
    }
    for (const o of e.node.options) {
      const long = (o.long ?? '').replace(/^--/, '')
      if (!long) continue
      lines.push(`complete -c dbcli -n '${cond}' -l ${long} -d '${sanitize(o.description || o.long || '')}'`)
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

export async function installCompletion(shell: string, script: string): Promise<void> {
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

  const block = `\n${MARKER_START}\neval "$(DBCLI_NO_UPDATE_CHECK=1 dbcli completion ${shell})"\n${MARKER_END}\n`
  content = content.trimEnd() + '\n' + block

  await Bun.file(targetPath).write(content)
  console.log(colors.success(`✓ Completion installed to ${targetPath}`))
  console.log(colors.info(`  Run: source ${targetPath}`))
}

type Generator = (root: CompletionCommandNode) => string

const GENERATORS: Record<string, Generator> = {
  bash: generateBashCompletion,
  zsh: generateZshCompletion,
  fish: generateFishCompletion,
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

    const root = buildCompletionTree(parentProgram)

    const installing = options.install !== undefined
    const shell = installing
      ? typeof options.install === 'string'
        ? options.install
        : (shellArg ?? detectShell())
      : (shellArg ?? detectShell())

    const generate = GENERATORS[shell]
    if (!generate) {
      console.error(colors.error(`Unsupported shell: ${shell}. Supported: bash, zsh, fish`))
      process.exit(1)
    }

    const script = generate(root)

    if (installing) {
      await installCompletion(shell, script)
      return
    }

    process.stdout.write(script)
  })

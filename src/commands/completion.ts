import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'node:fs/promises'
import {
  buildCompletionTree,
  flattenCommandTree,
  type CompletionCommandNode,
} from '@/core/completion/command-tree'

function resolveHome(): string {
  return process.env.HOME ?? homedir()
}

function optionFlags(node: CompletionCommandNode): string[] {
  return node.options.map((o) => o.long ?? o.short).filter((x): x is string => Boolean(x))
}

function childNames(node: CompletionCommandNode): string[] {
  return node.children.map((c) => c.name)
}

function commandPathKeys(root: CompletionCommandNode): string[] {
  return flattenCommandTree(root)
    .map((e) => e.path.join(' '))
    .filter(Boolean)
}

function optionValueKeys(root: CompletionCommandNode): string[] {
  return flattenCommandTree(root).flatMap((e) => {
    const path = e.path.join(' ')
    return e.node.options.flatMap((o) => {
      if (!o.requiredValue && !o.optionalValue) return []
      return [o.long, o.short]
        .filter((flag): flag is string => Boolean(flag))
        .map((flag) => `${path}|||${flag}`)
    })
  })
}

function bashCaseReturnFunction(name: string, values: readonly string[]): string {
  const arms = values.map((value) => `    "${value}") return 0 ;;`).join('\n')
  return `${name}() {
  case "$1" in
${arms}
  esac
  return 1
}`
}

function zshCaseReturnFunction(name: string, values: readonly string[]): string {
  const arms = values.map((value) => `    "${value}") return 0 ;;`).join('\n')
  return `${name}() {
  case "$1" in
${arms}
  esac
  return 1
}`
}

export function generateBashCompletion(root: CompletionCommandNode): string {
  const entries = flattenCommandTree(root)
  const rootOpts = optionFlags(root).join(' ')
  const commandPathHelper = bashCaseReturnFunction('_dbcli_is_command_path', commandPathKeys(root))
  const optionValueHelper = bashCaseReturnFunction(
    '_dbcli_option_takes_value_key',
    optionValueKeys(root)
  )

  const cmdArms = entries
    .filter((e) => e.node.children.length > 0)
    .map((e) => {
      const key = e.path.join(' ')
      const words = [...childNames(e.node), ...(e.path.length === 0 ? optionFlags(root) : [])].join(
        ' '
      )
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
${commandPathHelper}

${optionValueHelper}

_dbcli_option_takes_value() {
  _dbcli_option_takes_value_key "$1|||$2"
}

_dbcli_completions() {
  local cur path w i candidate skip_value
  cur="\${COMP_WORDS[COMP_CWORD]}"
  path=""
  skip_value=0
  for (( i=1; i < COMP_CWORD; i++ )); do
    w="\${COMP_WORDS[i]}"
    if [[ -z "$path" ]]; then candidate="$w"; else candidate="$path $w"; fi
    if _dbcli_is_command_path "$candidate"; then
      path="$candidate"
      skip_value=0
      continue
    fi
    if [[ "$skip_value" == "1" ]]; then
      skip_value=0
      continue
    fi
    if [[ "$w" == -* ]]; then
      if _dbcli_option_takes_value "$path" "$w"; then skip_value=1; fi
      continue
    fi
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
  const commandPathHelper = zshCaseReturnFunction('_dbcli_is_command_path', commandPathKeys(root))
  const optionValueHelper = zshCaseReturnFunction(
    '_dbcli_option_takes_value_key',
    optionValueKeys(root)
  )

  const cmdArms = entries
    .filter((e) => e.node.children.length > 0)
    .map((e) => {
      const key = e.path.join(' ')
      const words = [...childNames(e.node), ...(e.path.length === 0 ? optionFlags(root) : [])].join(
        ' '
      )
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
${commandPathHelper}

${optionValueHelper}

_dbcli_option_takes_value() {
  _dbcli_option_takes_value_key "$1|||$2"
}

_dbcli() {
  local path w i cur candidate skip_value
  cur="\${words[CURRENT]}"
  path=""
  skip_value=0
  for (( i=2; i < CURRENT; i++ )); do
    w="\${words[i]}"
    if [[ -z "$path" ]]; then candidate="$w"; else candidate="$path $w"; fi
    if _dbcli_is_command_path "$candidate"; then
      path="$candidate"
      skip_value=0
      continue
    fi
    if [[ "$skip_value" == "1" ]]; then
      skip_value=0
      continue
    fi
    if [[ "$w" == -* ]]; then
      if _dbcli_option_takes_value "$path" "$w"; then skip_value=1; fi
      continue
    fi
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
autoload -Uz compinit
(( $+functions[compdef] )) || compinit -D
compdef _dbcli dbcli
`
}

export function generateFishCompletion(root: CompletionCommandNode): string {
  const entries = flattenCommandTree(root)
  const fishPathCases = commandPathKeys(root)
    .map((path) => `        case '${path}'\n            return 0`)
    .join('\n')
  const fishOptionValueCases = optionValueKeys(root)
    .map((key) => `        case '${key}'\n            return 0`)
    .join('\n')
  const lines: string[] = [
    '# dbcli fish completion — auto-generated, do not edit',
    '',
    'function __fish_dbcli_known_path',
    "    set -l joined (string join ' ' $argv)",
    '    switch $joined',
    fishPathCases,
    '    end',
    '    return 1',
    'end',
    '',
    'function __fish_dbcli_option_takes_value',
    '    set -l key "$argv[1]|||$argv[2]"',
    '    switch $key',
    fishOptionValueCases,
    '    end',
    '    return 1',
    'end',
    '',
    'function __fish_dbcli_path',
    '    set -l tokens (commandline -opc)',
    '    set -l path',
    '    set -l skip_value 0',
    '    for t in $tokens[2..-1]',
    "        set -l candidate (string join ' ' $path $t)",
    '        if __fish_dbcli_known_path $candidate',
    '            set path $path $t',
    '            set skip_value 0',
    '            continue',
    '        end',
    '        if test $skip_value -eq 1',
    '            set skip_value 0',
    '            continue',
    '        end',
    "        if string match -q -- '-*' $t",
    "            set -l current_path (string join ' ' $path)",
    '            if __fish_dbcli_option_takes_value "$current_path" "$t"',
    '                set skip_value 1',
    '            end',
    '            continue',
    '        end',
    '    end',
    "    test (string join ' ' $path) = (string join ' ' $argv)",
    'end',
    '',
  ]

  const sanitize = (s: string): string => s.replace(/'/g, '')

  for (const e of entries) {
    const cond =
      e.path.length === 0 ? '__fish_use_subcommand' : `__fish_dbcli_path ${e.path.join(' ')}`
    for (const child of e.node.children) {
      lines.push(
        `complete -c dbcli -n '${cond}' -a ${child.name} -d '${sanitize(child.description) || child.name}'`
      )
    }
    for (const o of e.node.options) {
      const long = (o.long ?? '').replace(/^--/, '')
      if (!long) continue
      lines.push(
        `complete -c dbcli -n '${cond}' -l ${long} -d '${sanitize(o.description || o.long || '')}'`
      )
    }
  }

  return lines.join('\n') + '\n'
}

export function getInstallPath(shell: string): string {
  const home = resolveHome()
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
    const dir = join(resolveHome(), '.config', 'fish', 'completions')
    await mkdir(dir, { recursive: true })
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

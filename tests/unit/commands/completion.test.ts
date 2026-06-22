import { describe, test, expect } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  getInstallPath,
  detectShell,
} from '../../../src/commands/completion'
import type { CompletionCommandNode } from '../../../src/core/completion/command-tree'

function opt(long: string): {
  long: string
  requiredValue: boolean
  optionalValue: boolean
  description: string
} {
  return { long, requiredValue: true, optionalValue: false, description: long }
}

const ROOT: CompletionCommandNode = {
  name: 'dbcli',
  description: 'root',
  options: [opt('--config'), opt('--use')],
  children: [
    { name: 'list', description: 'list', options: [opt('--format')], children: [] },
    { name: 'query', description: 'query', options: [opt('--format')], children: [] },
    {
      name: 'queries',
      description: 'snippets',
      options: [],
      children: [
        {
          name: 'list',
          description: 'list snippets',
          options: [opt('--format'), opt('--tag'), opt('--engine'), opt('--source')],
          children: [],
        },
      ],
    },
    {
      name: 'skill',
      description: 'skill',
      options: [opt('--lang')],
      children: [
        { name: 'context', description: 'context', options: [opt('--format')], children: [] },
      ],
    },
    {
      name: 'migrate',
      description: 'migrate',
      options: [],
      children: [
        {
          name: 'add-column',
          description: 'add column',
          options: [opt('--nullable'), opt('--default'), opt('--unique')],
          children: [],
        },
      ],
    },
    {
      name: 'verify',
      description: 'verify',
      options: [],
      children: [
        {
          name: 'safe-backfill',
          description: 'safe backfill',
          options: [opt('--after-write'), opt('--format'), opt('--subject-name'), opt('--summary')],
          children: [],
        },
      ],
    },
    {
      name: 'blacklist',
      description: 'blacklist',
      options: [],
      children: [
        {
          name: 'table',
          description: 'table rules',
          options: [],
          children: [{ name: 'add', description: 'add', options: [], children: [] }],
        },
      ],
    },
  ],
}

async function writeTempScript(name: string, script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dbcli-completion-'))
  const path = join(dir, name)
  await Bun.write(path, script)
  return path
}

async function runBashCompletion(script: string, words: readonly string[]): Promise<string[]> {
  const scriptPath = await writeTempScript('dbcli-completion.bash', script)
  const arrayWords = words.map((word) => `'${word.replace(/'/g, "'\\''")}'`).join(' ')
  const command = [
    `source "${scriptPath}"`,
    `COMP_WORDS=(${arrayWords})`,
    `COMP_CWORD=${words.length - 1}`,
    '_dbcli_completions',
    'printf "%s\\n" "${COMPREPLY[@]}"',
  ].join('; ')
  const output = await Bun.$`bash -lc ${command}`.text()
  return output.trim().split('\n').filter(Boolean)
}

describe('generateBashCompletion', () => {
  const script = generateBashCompletion(ROOT)
  test('has shebang and registration', () => {
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('complete -F _dbcli_completions dbcli')
  })
  test('root case lists top-level commands', () => {
    expect(script).toContain('list')
    expect(script).toContain('queries')
  })
  test('nested queries list options branch is present and non-empty', () => {
    expect(script).toContain('"queries list")')
    expect(script).toContain('--format --tag --engine --source')
  })
  test('migrate add-column options branch', () => {
    expect(script).toContain('"migrate add-column")')
    expect(script).toContain('--nullable --default --unique')
  })
  test('verify safe-backfill options branch', () => {
    expect(script).toContain('"verify safe-backfill")')
    expect(script).toContain('--after-write --format --subject-name --summary')
  })
  test('two-level blacklist table subcommand branch', () => {
    expect(script).toContain('"blacklist table")')
    expect(script).toContain('add')
  })
  test('keeps nested option completion after option values', async () => {
    const candidates = await runBashCompletion(script, [
      'dbcli',
      'queries',
      'list',
      '--format',
      'json',
      '--',
    ])
    expect(candidates).toContain('--tag')
    expect(candidates).toContain('--engine')
    expect(candidates).not.toContain('--config')
  })
  test('keeps command option completion after positional args', async () => {
    const candidates = await runBashCompletion(script, ['dbcli', 'query', 'select 1', '--'])
    expect(candidates).toContain('--format')
    expect(candidates).not.toContain('--config')
  })
  test('keeps child command path after parent option value', async () => {
    const candidates = await runBashCompletion(script, [
      'dbcli',
      'skill',
      '--lang',
      'zh-TW',
      'context',
      '--',
    ])
    expect(candidates).toContain('--format')
    expect(candidates).not.toContain('--config')
  })
})

describe('generateZshCompletion', () => {
  const script = generateZshCompletion(ROOT)
  test('has compdef header', () => {
    expect(script).toContain('#compdef dbcli')
  })
  test('nested branches present', () => {
    expect(script).toContain('"queries list")')
    expect(script).toContain('--format --tag --engine --source')
    expect(script).toContain('"blacklist table")')
  })
  test('registers function instead of invoking compadd during rc eval', async () => {
    const scriptPath = await writeTempScript('dbcli-completion.zsh', script)
    await Bun.$`zsh -f -c ${`eval "$(cat "${scriptPath}")"`}`.quiet()
    expect(script).toContain('compdef _dbcli dbcli')
    expect(script).not.toContain('_dbcli "$@"')
  })
})

describe('generateFishCompletion', () => {
  const script = generateFishCompletion(ROOT)
  test('root subcommand completion', () => {
    expect(script).toContain('__fish_use_subcommand')
    expect(script).toContain('-a queries')
  })
  test('scoped nested subcommand + option completion', () => {
    expect(script).toContain('__fish_dbcli_path queries list')
    expect(script).toContain('__fish_dbcli_path blacklist table')
    expect(script).toContain('-l after-write')
  })
  test('known path cases return for each matched path', () => {
    expect(script).toContain("case 'queries list'\n            return 0")
    expect(script).toContain("case 'skill context'\n            return 0")
  })
})

describe('getInstallPath', () => {
  test('returns ~/.bashrc for bash', () => {
    expect(getInstallPath('bash')).toContain('.bashrc')
  })
  test('returns ~/.zshrc for zsh', () => {
    expect(getInstallPath('zsh')).toContain('.zshrc')
  })
  test('returns fish completions dir for fish', () => {
    const result = getInstallPath('fish')
    expect(result).toContain('fish')
    expect(result).toContain('completions')
    expect(result).toContain('dbcli.fish')
  })
  test('throws for unsupported shell', () => {
    expect(() => getInstallPath('csh')).toThrow()
  })
})

describe('detectShell', () => {
  test('detects shell from SHELL env var', () => {
    const original = process.env.SHELL
    process.env.SHELL = '/bin/zsh'
    expect(detectShell()).toBe('zsh')
    process.env.SHELL = original
  })
})

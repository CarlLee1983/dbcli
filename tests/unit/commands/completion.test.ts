import { describe, test, expect } from 'bun:test'
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  getInstallPath,
  detectShell,
} from '../../../src/commands/completion'
import type { CompletionCommandNode } from '../../../src/core/completion/command-tree'

function opt(long: string): { long: string; requiredValue: boolean; optionalValue: boolean; description: string } {
  return { long, requiredValue: true, optionalValue: false, description: long }
}

const ROOT: CompletionCommandNode = {
  name: 'dbcli',
  description: 'root',
  options: [opt('--config'), opt('--use')],
  children: [
    { name: 'list', description: 'list', options: [opt('--format')], children: [] },
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
})

describe('generateFishCompletion', () => {
  const script = generateFishCompletion(ROOT)
  test('root subcommand completion', () => {
    expect(script).toContain("__fish_use_subcommand")
    expect(script).toContain('-a queries')
  })
  test('scoped nested subcommand + option completion', () => {
    expect(script).toContain('__fish_dbcli_path queries list')
    expect(script).toContain('__fish_dbcli_path blacklist table')
    expect(script).toContain('-l after-write')
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

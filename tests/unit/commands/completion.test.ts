import { describe, test, expect } from 'bun:test'
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  getInstallPath,
  detectShell,
} from '../../../src/commands/completion'

describe('completion script generation', () => {
  const mockCommands = [
    { name: 'init', options: ['--system', '--host', '--port'] },
    { name: 'list', options: ['--format'] },
    { name: 'query', options: ['--format', '--limit', '--no-limit'] },
    { name: 'doctor', options: ['--format'] },
  ]
  const globalOptions = ['--config', '--verbose', '--quiet', '--no-color', '--version', '--help']

  describe('generateBashCompletion', () => {
    test('produces valid bash completion script', () => {
      const script = generateBashCompletion(mockCommands, globalOptions)
      expect(script).toContain('#!/bin/bash')
      expect(script).toContain('complete')
      expect(script).toContain('dbcli')
      expect(script).toContain('init')
      expect(script).toContain('list')
      expect(script).toContain('query')
      expect(script).toContain('doctor')
    })
  })

  describe('generateZshCompletion', () => {
    test('produces valid zsh completion script', () => {
      const script = generateZshCompletion(mockCommands, globalOptions)
      expect(script).toContain('#compdef dbcli')
      expect(script).toContain('init')
      expect(script).toContain('query')
      expect(script).toContain('--format')
    })
  })

  describe('generateFishCompletion', () => {
    test('produces valid fish completion script', () => {
      const script = generateFishCompletion(mockCommands, globalOptions)
      expect(script).toContain('complete')
      expect(script).toContain('dbcli')
      expect(script).toContain('init')
      expect(script).toContain('query')
    })
  })

  describe('getInstallPath', () => {
    test('returns ~/.bashrc for bash', () => {
      const result = getInstallPath('bash')
      expect(result).toContain('.bashrc')
    })

    test('returns ~/.zshrc for zsh', () => {
      const result = getInstallPath('zsh')
      expect(result).toContain('.zshrc')
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
})

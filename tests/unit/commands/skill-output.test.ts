/**
 * `dbcli skill --output` robustness: it should create missing parent directories
 * (like `--install` does) and, when `--install` is also passed, tell the user the
 * install was skipped instead of silently ignoring it. Throwaway HOME + cwd.
 */

import { test, expect, describe, spyOn, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { skillCommand, getInstallPath } from '../../../src/commands/skill'

describe('skill --output', () => {
  const origHome = process.env.HOME
  const origCwd = process.cwd()
  let sandbox = ''

  const logSpy = spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  const exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never)

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-output-'))
    process.env.HOME = sandbox
    process.chdir(sandbox)
    logSpy.mockClear()
    errorSpy.mockClear()
    exitSpy.mockClear()
  })

  afterEach(() => {
    process.chdir(origCwd)
    process.env.HOME = origHome
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  test('creates missing parent directories', async () => {
    const out = join(sandbox, 'nested', 'deep', 'SKILL.md')
    await skillCommand({} as any, { output: out })

    expect(exitSpy).not.toHaveBeenCalled()
    expect(existsSync(out)).toBe(true)
    expect(await Bun.file(out).text()).toContain('# dbcli')
  })

  test('with --install also set: warns and skips the install', async () => {
    const out = join(sandbox, 'SKILL.md')
    await skillCommand({} as any, { output: out, install: 'claude' })

    expect(existsSync(out)).toBe(true)
    // --output wins; the install path must not be written silently.
    expect(existsSync(getInstallPath('claude'))).toBe(false)

    const warned = errorSpy.mock.calls.flat().join('\n').toLowerCase()
    expect(warned).toContain('install')
    expect(warned).toContain('ignore')
  })
})

afterAll(() => {
  mock.restore()
})

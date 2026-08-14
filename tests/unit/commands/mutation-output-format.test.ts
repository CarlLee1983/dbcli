/**
 * `--format` on insert/update/delete only ever meant "text or json" — the
 * help text said so — but nothing enforced it, so `--format xml` silently
 * fell back to prose on a TTY. These tests pin the rejection, and that it
 * happens before any connection is opened: the value is validated off the
 * flag alone, same as `dbcli export` validates its own formats.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
import { updateCommand } from '@/commands/update'
import { deleteCommand } from '@/commands/delete'

describe('mutation commands reject an unsupported --format', () => {
  let configSpy: ReturnType<typeof spyOn>
  let errSpy: ReturnType<typeof spyOn>
  let logSpy: ReturnType<typeof spyOn>
  let exitSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    configSpy = spyOn(configModule, 'read')
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
  })

  afterEach(() => {
    configSpy.mockRestore()
    errSpy.mockRestore()
    logSpy.mockRestore()
    exitSpy.mockRestore()
  })

  function combinedOutput(): string {
    const fromLog = logSpy.mock.calls.flat().join('\n')
    const fromErr = errSpy.mock.calls.flat().join('\n')
    return `${fromLog}\n${fromErr}`
  }

  test('insert rejects --format xml before touching the config', async () => {
    try {
      await insertCommand('users', { data: '{"a":1}', format: 'xml' as never })
    } catch {
      /* exit sentinel */
    }
    expect(configSpy).not.toHaveBeenCalled()
    expect(combinedOutput()).toContain('xml')
  })

  test('update rejects --format xml before touching the config', async () => {
    try {
      await updateCommand('users', { where: 'id=1', set: '{"a":1}', format: 'xml' as never })
    } catch {
      /* exit sentinel */
    }
    expect(configSpy).not.toHaveBeenCalled()
    expect(combinedOutput()).toContain('xml')
  })

  test('delete rejects --format xml before touching the config', async () => {
    try {
      await deleteCommand('users', { where: 'id=1', format: 'xml' as never })
    } catch {
      /* exit sentinel */
    }
    expect(configSpy).not.toHaveBeenCalled()
    expect(combinedOutput()).toContain('xml')
  })

  test('--plan is validated too — the flag is read before the --plan branch', async () => {
    try {
      await insertCommand('users', { data: '{"a":1}', plan: true, format: 'xml' as never })
    } catch {
      /* exit sentinel */
    }
    expect(configSpy).not.toHaveBeenCalled()
    expect(combinedOutput()).toContain('xml')
  })

  test('an unset --format is still allowed', async () => {
    configSpy.mockResolvedValue({
      connection: undefined,
    } as never)
    try {
      await insertCommand('users', { data: '{"a":1}' })
    } catch {
      /* exit sentinel: "Run dbcli init" error, not a format error */
    }
    expect(combinedOutput()).not.toContain('--format')
  })
})

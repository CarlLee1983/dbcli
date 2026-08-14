import { describe, test, expect } from 'bun:test'
import { resolveNewPassword } from '@/commands/credential'

function io(overrides: Partial<Parameters<typeof resolveNewPassword>[1]> = {}) {
  return {
    isTTY: true,
    readStdin: async () => 'from-stdin\n',
    prompt: async () => 'from-prompt',
    ...overrides,
  }
}

describe('resolveNewPassword — input sources', () => {
  test('takes the inline --password value verbatim', async () => {
    expect(await resolveNewPassword({ password: '  spaced  ' }, io())).toBe('  spaced  ')
  })

  test('reads stdin and drops only the trailing newline', async () => {
    expect(await resolveNewPassword({ stdin: true }, io())).toBe('from-stdin')
  })

  test('keeps meaningful whitespace inside a piped value', async () => {
    const reader = io({ readStdin: async () => 'a b\r\n' })
    expect(await resolveNewPassword({ stdin: true }, reader)).toBe('a b')
  })

  test('prompts when no source is given and the terminal is interactive', async () => {
    expect(await resolveNewPassword({}, io())).toBe('from-prompt')
  })

  test('refuses both --password and --stdin at once', async () => {
    await expect(resolveNewPassword({ password: 'x', stdin: true }, io())).rejects.toThrow(
      /擇一|cannot be used together/i
    )
  })

  test('refuses to prompt when stdin is not a terminal', async () => {
    await expect(resolveNewPassword({}, io({ isTTY: false }))).rejects.toThrow(/--stdin/)
  })

  test('rejects an empty value from any source', async () => {
    await expect(resolveNewPassword({ password: '' }, io())).rejects.toThrow(/空|empty/i)
    await expect(
      resolveNewPassword({ stdin: true }, io({ readStdin: async () => '\n' }))
    ).rejects.toThrow(/空|empty/i)
  })
})

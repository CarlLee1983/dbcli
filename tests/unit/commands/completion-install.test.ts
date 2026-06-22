import { describe, test, expect } from 'bun:test'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCompletion, getInstallPath } from '../../../src/commands/completion'

const MARKER_START = '# >>> dbcli completion >>>'

async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const original = process.env.HOME
  const home = await mkdtemp(join(tmpdir(), 'dbcli-home-'))
  process.env.HOME = home
  try {
    await fn(home)
  } finally {
    if (original === undefined) delete process.env.HOME
    else process.env.HOME = original
  }
}

function countMarkers(content: string): number {
  return (content.match(new RegExp(MARKER_START, 'g')) ?? []).length
}

describe('installCompletion (temp HOME)', () => {
  test('bash writes exactly one marker block to ~/.bashrc', async () => {
    await withTempHome(async (home) => {
      await installCompletion('bash', '# script')
      const content = await readFile(join(home, '.bashrc'), 'utf8')
      expect(countMarkers(content)).toBe(1)
      expect(content).toContain('DBCLI_NO_UPDATE_CHECK=1 dbcli completion bash')
    })
  })

  test('zsh writes exactly one marker block to ~/.zshrc', async () => {
    await withTempHome(async (home) => {
      await installCompletion('zsh', '# script')
      const content = await readFile(join(home, '.zshrc'), 'utf8')
      expect(countMarkers(content)).toBe(1)
    })
  })

  test('re-running install replaces, never duplicates the block', async () => {
    await withTempHome(async (home) => {
      await installCompletion('zsh', '# script')
      await installCompletion('zsh', '# script')
      const content = await readFile(join(home, '.zshrc'), 'utf8')
      expect(countMarkers(content)).toBe(1)
    })
  })

  test('fish creates the completions file', async () => {
    await withTempHome(async (home) => {
      await installCompletion('fish', '# fish script')
      const filePath = join(home, '.config', 'fish', 'completions', 'dbcli.fish')
      const info = await stat(filePath)
      expect(info.isFile()).toBe(true)
      const content = await readFile(filePath, 'utf8')
      expect(content).toContain('# fish script')
    })
  })

  test('unsupported shell throws and writes nothing', async () => {
    await withTempHome(async () => {
      expect(() => getInstallPath('csh')).toThrow()
      await expect(installCompletion('csh', '# script')).rejects.toThrow()
    })
  })
})

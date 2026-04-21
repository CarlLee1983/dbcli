import { describe, expect, test, spyOn } from 'bun:test'
import { runBatchSession } from '@/commands/shell'

describe('shell batch session', () => {
  test('processes piped lines sequentially and stops on quit', async () => {
    const outputs: string[] = []
    const engine = {
      processInput: async (line: string) => {
        if (line.startsWith('query ')) {
          outputs.push(line)
          return { action: 'continue' as const, output: '{"ok":true}' }
        }
        if (line === '.quit') {
          return { action: 'quit' as const, output: 'Goodbye.' }
        }
        return { action: 'continue' as const }
      },
    }

    const logSpy = spyOn(console, 'log').mockImplementation((...args) => {
      outputs.push(args.join(' '))
    })

    try {
      await runBatchSession(engine as any, 'query {"a":1}\n.quit\nquery {"b":2}\n')
    } finally {
      logSpy.mockRestore()
    }

    expect(outputs).toContain('query {"a":1}')
    expect(outputs).toContain('{"ok":true}')
    expect(outputs).not.toContain('query {"b":2}')
  })
})

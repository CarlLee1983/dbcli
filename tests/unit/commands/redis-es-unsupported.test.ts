import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { configModule } from '@/core/config'
import { insertCommand } from '@/commands/insert'
import { updateCommand } from '@/commands/update'
import { deleteCommand } from '@/commands/delete'
import { diffCommand } from '@/commands/diff'

const redisConfig = {
  connection: {
    system: 'redis' as const,
    host: '127.0.0.1',
    port: 6379,
    user: '',
    password: '',
    database: '0',
  },
  permission: 'data-admin' as const,
  schema: {},
  metadata: { version: '1.0' },
}

const esConfig = {
  connection: {
    system: 'elasticsearch' as const,
    host: '127.0.0.1',
    port: 9200,
    user: '',
    password: '',
    database: '',
  },
  permission: 'data-admin' as const,
  schema: {},
  metadata: { version: '1.0' },
}

describe('Redis/Elasticsearch unsupported write commands surface clear errors', () => {
  let configSpy: any
  let errSpy: any
  let logSpy: any
  let exitSpy: any

  beforeEach(() => {
    errSpy = spyOn(console, 'error').mockImplementation(() => {})
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
  })

  afterEach(() => {
    configSpy?.mockRestore()
    errSpy.mockRestore()
    logSpy.mockRestore()
    exitSpy.mockRestore()
  })

  function combinedOutput(): string {
    const fromLog = logSpy.mock.calls.flat().join('\n')
    const fromErr = errSpy.mock.calls.flat().join('\n')
    return `${fromLog}\n${fromErr}`
  }

  describe('Redis', () => {
    beforeEach(() => {
      configSpy = spyOn(configModule, 'read').mockResolvedValue(redisConfig as any)
    })

    test('diff reports Redis is unsupported', async () => {
      try {
        await diffCommand.parseAsync(['node', 'dbcli', '--snapshot', '/tmp/dbcli-diff-redis.json'])
      } catch {
        /* ignore */
      }
      const out = combinedOutput()
      expect(out).toContain('Redis')
      expect(out).toContain('不支援')
    })
  })

  describe('Elasticsearch', () => {
    beforeEach(() => {
      configSpy = spyOn(configModule, 'read').mockResolvedValue(esConfig as any)
    })

    test('insert reports Elasticsearch is unsupported', async () => {
      try {
        await insertCommand('idx', { data: '{"foo":"bar"}', force: true })
      } catch {
        /* ignore */
      }
      const out = combinedOutput()
      expect(out).toContain('Elasticsearch')
      expect(out).toContain('不支援')
    })

    test('update reports Elasticsearch is unsupported', async () => {
      try {
        await updateCommand('idx', { where: 'id=1', set: '{"foo":"bar"}', force: true })
      } catch {
        /* ignore */
      }
      const out = combinedOutput()
      expect(out).toContain('Elasticsearch')
      expect(out).toContain('不支援')
    })

    test('delete reports Elasticsearch is unsupported', async () => {
      try {
        await deleteCommand('idx', { where: 'id=1', force: true })
      } catch {
        /* ignore */
      }
      const out = combinedOutput()
      expect(out).toContain('Elasticsearch')
      expect(out).toContain('不支援')
    })

    test('diff reports Elasticsearch is unsupported', async () => {
      try {
        await diffCommand.parseAsync(['node', 'dbcli', '--snapshot', '/tmp/dbcli-diff-es.json'])
      } catch {
        /* ignore */
      }
      const out = combinedOutput()
      expect(out).toContain('Elasticsearch')
      expect(out).toContain('不支援')
    })
  })
})

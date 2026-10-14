import { describe, expect, test } from 'bun:test'
import { MongoClient } from 'mongodb'
import { decomposeConnectionString } from '@/core/mongodb-connection-string'

describe('MongoDB Unix socket URI preservation', () => {
  test.each([
    ['%2Ftmp%2Fmongodb-27017.sock', '/tmp/mongodb-27017.sock'],
    ['%2ftmp%2fMongoDB.sock', '/tmp/MongoDB.sock'],
    ['%2Ftmp%2Fmy%20database.sock', '/tmp/my database.sock'],
    ['relative.sock', 'relative.sock'],
  ])('preserves driver-recognized socket %s', (authority, path) => {
    const uri = `mongodb://user:p%40ss@${authority}/app?authSource=admin&appName=socket-test`
    const result = decomposeConnectionString(uri)
    expect(result).toEqual({
      kind: 'uri',
      database: 'app',
      reasons: [{ type: 'unix-socket' }],
    })
    // Construction parses options without opening a connection or needing a server.
    const options = new MongoClient(uri).options
    expect(options.hosts[0]?.socketPath).toBe(path)
    expect(options.hosts[0]?.port).toBeUndefined()
    expect(options.credentials?.password).toBe('p@ss')
    expect(options.credentials?.source).toBe('admin')
    expect(options.appName).toBe('socket-test')
  })

  test('retains multiple fallback reasons for a socket replica set', () => {
    expect(decomposeConnectionString('mongodb://%2Ftmp%2Fa.sock,localhost/app')).toEqual({
      kind: 'uri',
      database: 'app',
      reasons: [{ type: 'unix-socket' }, { type: 'multi-host' }],
    })
  })

  test.each([
    'mongodb://localhost/app',
    'mongodb://db.sock.example/app',
    'mongodb+srv://cluster.example.com/app',
  ])('keeps TCP/SRV decomposition for %s', (uri) => {
    expect(decomposeConnectionString(uri).kind).toBe('fields')
  })
})

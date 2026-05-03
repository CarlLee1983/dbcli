import { describe, test, expect } from 'bun:test'
import { parseYamlMini } from '@/core/saved-queries/yaml-mini'

describe('parseYamlMini', () => {
  test('parses scalar map', () => {
    const out = parseYamlMini(['name: Daily Active Users', 'description: hello'].join('\n'))
    expect(out).toEqual({ name: 'Daily Active Users', description: 'hello' })
  })

  test('parses inline list', () => {
    const out = parseYamlMini('tags: [analytics, daily]')
    expect(out).toEqual({ tags: ['analytics', 'daily'] })
  })

  test('parses nested map (params)', () => {
    const text = [
      'params:',
      '  days:',
      '    type: int',
      '    default: 7',
      '  org_id:',
      '    type: string',
      '    required: true',
    ].join('\n')
    expect(parseYamlMini(text)).toEqual({
      params: {
        days: { type: 'int', default: 7 },
        org_id: { type: 'string', required: true },
      },
    })
  })

  test('parses single-string engine', () => {
    expect(parseYamlMini('engine: postgres')).toEqual({ engine: 'postgres' })
  })

  test('parses inline-list engine', () => {
    expect(parseYamlMini('engine: [postgres, mysql]')).toEqual({ engine: ['postgres', 'mysql'] })
  })

  test('coerces numeric and boolean scalars', () => {
    expect(parseYamlMini('a: 7\nb: true\nc: false\nd: 1.5')).toEqual({
      a: 7,
      b: true,
      c: false,
      d: 1.5,
    })
  })

  test('rejects tab indentation', () => {
    expect(() => parseYamlMini('params:\n\tdays: 7')).toThrow(/tab/i)
  })

  test('rejects unsupported anchor syntax', () => {
    expect(() => parseYamlMini('a: &x 1')).toThrow(/anchor|unsupported/i)
  })
})

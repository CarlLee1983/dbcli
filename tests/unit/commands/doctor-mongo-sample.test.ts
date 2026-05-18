import { describe, test, expect } from 'bun:test'
import { renderMongoSamplingLine } from '@/commands/doctor'

describe('doctor mongo sampling line', () => {
  test('emits method + size when present', () => {
    expect(renderMongoSamplingLine({ sampleMethod: 'random', sampleSize: 100 })).toMatch(
      /method=random.*size=100/
    )
  })
  test('returns empty string when sampleMethod missing (legacy cache)', () => {
    expect(renderMongoSamplingLine({})).toBe('')
  })
})

import { test, expect } from 'bun:test'
import en from '../../../resources/lang/en/messages.json'
import zhTW from '../../../resources/lang/zh-TW/messages.json'

test('root agent-output help has distinct English and Traditional Chinese messages', () => {
  const english = (en.cli as { agent_output_option: string }).agent_output_option
  const translated = (zhTW.cli as { agent_output_option: string }).agent_output_option

  expect(english).toContain('Operation Envelope v1')
  expect(english).toContain('capabilities check only')
  expect(translated).toContain('Operation Envelope v1')
  expect(translated).toContain('capabilities check')
  expect(translated).not.toBe(english)
})

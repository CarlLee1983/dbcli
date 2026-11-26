import { test, expect } from 'bun:test'
import en from '../../../resources/lang/en/messages.json'
import zhTW from '../../../resources/lang/zh-TW/messages.json'

test('root agent-output help has distinct English and Traditional Chinese messages', () => {
  const english = (en.cli as { agent_output_option: string }).agent_output_option
  const translated = (zhTW.cli as { agent_output_option: string }).agent_output_option

  for (const message of [english, translated]) {
    for (const term of [
      'Operation Envelope v1',
      'capabilities',
      'capabilities check',
      'query',
      'q @',
      'SQL',
    ]) {
      expect(message).toContain(term)
    }
  }
  expect(translated).not.toBe(english)
})

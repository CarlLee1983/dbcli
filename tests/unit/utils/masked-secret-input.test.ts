import { test, expect, describe, afterEach } from 'bun:test'
import { maskedInputUnavailableError, secret } from '../../../src/utils/prompts'
import { redactSecretsForDisplay } from '../../../src/utils/redaction'

// Never assert on the canary itself in a failure message — an assertion that
// prints it defeats the property under test.
const CANARY = 'Sup3rSecretCanary'
const ESCAPE = '\u001b'

const originalIsTTY = process.stdin.isTTY
const setTTY = (value: boolean | undefined) => {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
}

afterEach(() => setTTY(originalIsTTY as boolean | undefined))

describe('maskedInputUnavailableError', () => {
  test('names only the guidance the caller supplied', () => {
    const error = maskedInputUnavailableError('pass --password instead')

    expect(error.message).toContain('pass --password instead')
    expect(error.message).not.toContain('--stdin')
  })

  test('never reproduces a raw loader error', () => {
    const error = maskedInputUnavailableError('pass --uri instead', new Error(`ENOENT ${CANARY}`))

    expect(error.message.includes(CANARY)).toBe(false)
    expect(error.message).not.toContain('ENOENT')
  })

  test('stays bounded', () => {
    const error = maskedInputUnavailableError('g'.repeat(5000))
    expect(error.message.length).toBeLessThanOrEqual(300)
  })
})

describe('secret', () => {
  test('fails closed without a TTY instead of reading plaintext', async () => {
    setTTY(undefined)

    const failed = await secret('Database password: ', { unavailable: 'pass --password' }).then(
      () => false,
      (error: Error) => {
        expect(error.message).toContain('pass --password')
        expect(error.message).not.toContain('--stdin')
        return true
      }
    )

    expect(failed).toBe(true)
  })
})

describe('redactSecretsForDisplay', () => {
  test('removes a literal secret the caller collected', () => {
    const redacted = redactSecretsForDisplay(`auth failed for ${CANARY}`, [CANARY])

    expect(redacted.includes(CANARY)).toBe(false)
    expect(redacted).toContain('<redacted>')
  })

  test('still applies the shared credential patterns', () => {
    const redacted = redactSecretsForDisplay('mongodb://app:hunter2@db:27017/shop', [])

    expect(redacted).not.toContain('hunter2')
  })

  test('ignores empty secrets so an unauthenticated connection is not mangled', () => {
    expect(redactSecretsForDisplay('connection refused', ['', '   '])).toBe('connection refused')
  })

  test('bounds and escapes what it returns', () => {
    const redacted = redactSecretsForDisplay(`a${ESCAPE}[2Kb${'c'.repeat(5000)}`, [])

    expect(redacted.length).toBeLessThanOrEqual(300)
    expect(redacted).not.toContain(ESCAPE)
  })
})

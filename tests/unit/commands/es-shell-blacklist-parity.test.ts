/**
 * The Elasticsearch shell's two enforcement points answer the same question as
 * every other blacklist matcher — ADR-0020 Decision 1, ADR-0019 Decision 2.
 *
 * `namesProtectedField` and `redactFields` compared rules and names byte for
 * byte, so `dbcli es` returned what `dbcli query --index` masked under the same
 * configuration: a rule spelled in another case protected nothing, and a rule
 * carrying a wildcard was never compiled at all.
 */
import { describe, test, expect } from 'bun:test'
import {
  collectProtectedFields,
  namesProtectedField,
  redactFields,
} from '@/commands/es-shell-guards'

const response = {
  hits: { hits: [{ _source: { id: 1, password: 'plain', profile: { SSN: 'x' } } }] },
}

function leaks(rules: string[]): boolean {
  const fields = collectProtectedFields({ users: rules })
  return JSON.stringify(redactFields(response, fields)).includes('plain')
}

describe('the ES shell folds and globs like every other matcher', () => {
  test.each([['Password'], ['PASS*'], ['pass*']])('rule %p redacts `password`', (rule) => {
    expect(leaks([rule])).toBe(false)
  })

  test('a nested rule reaches a nested key whatever its case', () => {
    const fields = collectProtectedFields({ users: ['profile.ssn'] })
    expect(JSON.stringify(redactFields(response, fields))).not.toContain('"x"')
  })

  test('the request check refuses a name a rule reaches', () => {
    expect(namesProtectedField('password', collectProtectedFields({ users: ['Password'] }))).toBe(
      true
    )
    expect(namesProtectedField('PASSWORD', collectProtectedFields({ users: ['password'] }))).toBe(
      true
    )
    expect(namesProtectedField('password', collectProtectedFields({ users: ['pass*'] }))).toBe(true)
  })

  // A rule the matcher cannot read has to stop the request, and stopping it on
  // the way back means the cluster already acted on it. ADR-0019 Decision 3.
  // An entry carrying a metacharacter is a pattern and nothing else. While it
  // sat in the literal set too, `back\\slash` matched itself by equality and
  // `Back\\Slash` matched nothing — one rule, two answers, decided by its case.
  test('a rule with an escape means the same thing in either case', () => {
    const masked = (rule: string, key: string): boolean => {
      const fields = collectProtectedFields({ users: [rule] })
      const out = redactFields({ [key]: 'plain' }, fields) as Record<string, unknown>
      return !('plain' === out[key])
    }
    expect(masked('Back\\Slash', 'backslash')).toBe(true)
    expect(masked('back\\slash', 'backslash')).toBe(true)
    expect(masked('Back\\Slash', 'BackSlash')).toBe(true)
    expect(masked('Report\\*', 'report*')).toBe(true)
    expect(masked('Report\\*', 'reportX')).toBe(false)
  })

  // The same normalisation the config loader applies: a quoted or padded entry
  // was a dead rule here and a live one everywhere else.
  test('a quoted or padded rule is normalised the way the loader normalises it', () => {
    const fields = collectProtectedFields({ users: ['"Token"', ' secret '] })
    expect(namesProtectedField('token', fields)).toBe(true)
    expect(namesProtectedField('secret', fields)).toBe(true)
  })

  test('an unreadable rule is refused while collecting, before the request is sent', () => {
    expect(() => collectProtectedFields({ users: ['a.**'] })).toThrow(/BlacklistRejection/)
  })

  test('a name no rule reaches is still allowed', () => {
    const fields = collectProtectedFields({ users: ['password'] })
    expect(namesProtectedField('passwordless', fields)).toBe(false)
    expect(leaks(['api_key'])).toBe(true)
  })
})

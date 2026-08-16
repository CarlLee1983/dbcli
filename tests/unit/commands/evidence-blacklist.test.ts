import { describe, expect, test } from 'bun:test'
import { blockedTerms, containsBlockedTerm } from '@/commands/evidence'

describe('evidence blacklist matching', () => {
  // Terms were matched as unbounded substrings, so a blacklisted column named
  // `id` blocked any claim containing "identifier", "considered", or "valid" —
  // and the error named no term, so the author could not tell why.
  test.each([
    ['identifier', 'id'],
    ['considered', 'id'],
    ['pending', 'end'],
    ['keyword', 'key'],
    ['nonuser', 'user'],
    ['username', 'user'],
  ])('does not block the prose word %s for the term %s', (prose, term) => {
    expect(containsBlockedTerm(`The ${prose} was reviewed.`, [term])).toBe(false)
  })

  test.each([
    ['The id was reviewed.', 'id'],
    ['Rows in orders.id were counted.', 'id'],
    ['The secret_customer table was excluded.', 'secret_customer'],
    ['Checked ID casing.', 'id'],
    ['Values in "user" were masked.', 'user'],
  ])('blocks %s for the term %s', (prose, term) => {
    expect(containsBlockedTerm(prose, [term])).toBe(true)
  })

  test('treats a term with regex metacharacters literally', () => {
    expect(containsBlockedTerm('The a.c column was read.', ['a.c'])).toBe(true)
    expect(containsBlockedTerm('The abc column was read.', ['a.c'])).toBe(false)
  })

  test('ignores an empty or whitespace-only term', () => {
    expect(containsBlockedTerm('Anything at all.', ['', '   '])).toBe(false)
  })

  // The keys of blacklist.columns are table names. They were never added to the
  // term list, so a table protected only through a column entry was not blocked
  // when it appeared in prose.
  test('collects table names from both the tables list and the columns map keys', () => {
    const terms = blockedTerms({
      blacklist: { tables: ['audit_log'], columns: { secret_customers: ['ssn'] } },
    })
    expect(terms).toContain('audit_log')
    expect(terms).toContain('secret_customers')
    expect(terms).toContain('ssn')
  })

  test('lowercases and trims collected terms', () => {
    expect(blockedTerms({ blacklist: { tables: ['  Audit_Log  '], columns: {} } })).toEqual([
      'audit_log',
    ])
  })

  test('collects nothing when no blacklist is configured', () => {
    expect(blockedTerms({})).toEqual([])
  })
})

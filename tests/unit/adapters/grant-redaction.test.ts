import { expect, test } from 'bun:test'
import { redactGrant, OMITTED_GRANT } from '@/adapters/grant-redaction'

const prefix = 'GRANT USAGE ON *.* TO `reader`@`%`'
for (const clause of [
  "IDENTIFIED BY 'secret-sentinel'",
  "IDENTIFIED BY PASSWORD 'secret-sentinel'",
  "IDENTIFIED VIA mysql_native_password USING 'secret-sentinel'",
  "IDENTIFIED WITH plugin AS 'secret-sentinel'",
  "IDENTIFIED VIA plugin USING PASSWORD('secret-sentinel')",
  "IDENTIFIED VIA plugin AS PASSWORD('secret-sentinel') OR other USING 'second-secret-sentinel'",
  "IDENTIFIED VIA plugin USING 'secret-sentinel' OR unix_socket",
  'IDENTIFIED BY "secret-sentinel"',
  "IDENTIFIED BY 'secret-sentinel''tail'",
  "IDENTIFIED BY 'secret-sentinel\\n'",
  "IDENTIFIED\nBY\n'secret-sentinel'",
]) {
  test(`redacts known authentication: ${clause}`, () => {
    const out = redactGrant(`${prefix} ${clause}`)
    expect(out).not.toContain('secret-sentinel')
    expect(out).toContain('[REDACTED]')
    expect(out).toContain(prefix)
  })
}

test('empty payload is still visibly redacted and grant/resource options survive', () => {
  expect(redactGrant(`${prefix} IDENTIFIED BY '' WITH GRANT OPTION MAX_QUERIES_PER_HOUR 10`)).toBe(
    `${prefix} IDENTIFIED BY '[REDACTED]' WITH GRANT OPTION MAX_QUERIES_PER_HOUR 10`
  )
})

for (const text of [
  'GRANT SELECT, INSERT (`id`) ON `db`.`table` TO `reader`@`%`',
  "GRANT `role` TO 'reader'@'%' WITH ADMIN OPTION",
  "GRANT PROXY ON ''@'' TO 'reader'@'%' WITH GRANT OPTION",
  "SET DEFAULT ROLE `role` FOR 'reader'@'%'",
  'GRANT SELECT ON `IDENTIFIED`.`PASSWORD` TO `IDENTIFIED`@`PASSWORD`',
  `${prefix} REQUIRE SSL`,
]) {
  test(`keeps recognized privilege text: ${text}`, () => {
    expect(redactGrant(text)).toBe(text)
  })
}
for (const value of [
  `${prefix} IDENTIFIED FUTURE 'secret-sentinel'`,
  `${prefix} IDENTIFIED BY 'secret-sentinel`,
  `${prefix} IDENTIFIED BY 'secret-sentinel' UNKNOWN 'extra-secret'`,
  `${prefix} IDENTIFIED BY 'secret-sentinel\\'tail'`,
  `${prefix} IDENTIFIED VIA plugin USING`,
  `${prefix} IDENTIFIED BY PASSWORD`,
  `${prefix} /* unknown secret-sentinel */`,
  'SOMETHING NEW secret-sentinel',
  { secret: 'secret-sentinel' },
  null,
  42,
]) {
  test(`omits malformed/unknown cell ${JSON.stringify(value)}`, () => {
    expect(redactGrant(value)).toBe(OMITTED_GRANT)
  })
}

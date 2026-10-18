import { expect, test } from 'bun:test'
import { isGrantQuery } from '@/adapters/grant-query'

for (const dialect of ['mysql', 'mariadb'] as const) {
  for (const sql of [
    'SHOW GRANTS',
    ' show\n grants FOR CURRENT_USER(); ',
    '/* ordinary */ SHOW/**/GRANTS',
    '# prefix\nSHOW GRANTS',
    '-- prefix\nSHOW GRANTS',
    '/*! SHOW GRANTS */',
    'SHOW /*! GRANTS */',
    '/*!50000SHOW GRANTS */',
    "SHOW GRANTS FOR 'reader'@'%'",
    'SHOW GRANTS; -- tail',
  ]) {
    test(`${dialect} recognizes ${sql}`, () =>
      expect(isGrantQuery(sql, dialect === 'mysql' ? '8.4.8' : '10.11.6-MariaDB')).toBe(true))
  }
  for (const sql of [
    "SELECT 'SHOW GRANTS' AS `Grants for reader`",
    'SHOW CREATE USER reader',
    'SHOW TABLES',
    'SELECT 1 /* SHOW GRANTS */',
    '--not-a-comment\nSHOW GRANTS',
  ]) {
    test(`${dialect} leaves non-grant ${sql}`, () => expect(isGrantQuery(sql, '8.4.8')).toBe(false))
  }
}
test('conditional comments follow the cached version rather than hypothetical token combinations', () => {
  expect(isGrantQuery('/*!99999 SELECT */ SHOW GRANTS', '8.4.8')).toBe(true)
  expect(isGrantQuery("/*!99999 SHOW GRANTS */ SELECT 'safe' AS 'Grants for x'", '8.4.8')).toBe(
    false
  )
  expect(
    isGrantQuery("/*!80000 SELECT 'safe' AS 'Grants for x' */ /*!99999 SHOW GRANTS */", '8.4.8')
  ).toBe(false)
  for (const [version, expected] of [
    ['8.4.7', false],
    ['8.4.8', true],
    ['8.4.9', true],
  ] as const) {
    expect(isGrantQuery('/*!80408 SHOW GRANTS */', version)).toBe(expected)
  }
})
test('MariaDB-only syntax and MySQL exclusion range are respected', () => {
  expect(isGrantQuery('/*M!100000 SHOW GRANTS */', '8.4.8')).toBe(false)
  expect(isGrantQuery('/*M!100000 SHOW GRANTS */', '5.5.5-10.11.6-MariaDB')).toBe(true)
  expect(isGrantQuery('/*!50700 SHOW GRANTS */', '10.11.6-MariaDB')).toBe(false)
  expect(isGrantQuery('/*M!50700 SHOW GRANTS */', '10.11.6-MariaDB')).toBe(true)
})
test('unknown versions allow unambiguous statements and refuse ambiguity with static text', () => {
  expect(isGrantQuery('SHOW GRANTS')).toBe(true)
  expect(isGrantQuery('/*! SHOW GRANTS */')).toBe(true)
  expect(isGrantQuery("SELECT 'SHOW GRANTS' /*!99999 + 1 */")).toBe(false)
  expect(() => isGrantQuery('/*!80408 SHOW GRANTS */')).toThrow('Cannot safely classify')
})

test('MariaDB consumes adjacent sixth digit independently from MySQL whitespace rule', () => {
  expect(isGrantQuery('/*M!100000SHOW GRANTS */', '10.11.6-MariaDB')).toBe(true)
  expect(isGrantQuery('/*!100000SHOW GRANTS */', '10.11.6-MariaDB')).toBe(true)
  expect(isGrantQuery('/*!000000SHOW GRANTS */', '8.4.8')).toBe(false)
  expect(isGrantQuery('/*!000000 SHOW GRANTS */', '8.4.8')).toBe(true)
})
test('unknown server flavor refuses MariaDB-only grant rather than trusting configuration', () => {
  expect(() => isGrantQuery('/*M! SHOW GRANTS */')).toThrow('Cannot safely classify')
})

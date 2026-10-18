import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('CI skip mode runs offline grant coverage without Docker or live database fixtures', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      'test',
      '--timeout',
      '30000',
      '--test-name-pattern',
      'isolated Compose fixtures|query-only, agent=false, blacklist=false|nonexecuting plan|saved SHOW GRANTS',
      'tests/integration/grant-authentication-redaction.test.ts',
      'tests/integration/native-database-authorization.test.ts',
      'tests/integration/qualified-schema-inspection.test.ts',
    ],
    {
      cwd: resolve(import.meta.dir, '../..'),
      env: {
        ...process.env,
        PATH: '',
        SKIP_INTEGRATION_TESTS: 'true',
        REQUIRE_INTEGRATION_SERVICES: 'false',
        NO_COLOR: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const output = stdout + stderr
  expect(output).not.toContain('Executable not found')
  // Report failing test names, never raw child output containing grant payloads.
  const failedTests = output.match(/^\(fail\) .+$/gm) ?? []
  expect({ code, failedTests }).toEqual({ code: 0, failedTests: [] })
  expect(output).toContain('(pass) synthetic grants through actual adapter and output routes')
  expect(output).toContain('(pass) nonexecuting plan receipt excludes grant result data')
  expect(output).toContain('(pass) saved SHOW GRANTS remains rejected')
  expect(output).toContain(
    '(skip) isolated Compose fixtures > isolated Compose SHOW GRANTS with real CLI'
  )
  expect(output).toContain('(skip) isolated Compose fixtures > real MariaDB configured as mysql')
  expect(output).toContain(
    '(skip) isolated Compose fixtures > native database authorization through restricted real accounts'
  )
  expect(output).toContain(
    '(skip) isolated Compose fixtures > postgresql: qualified schema inspection'
  )
  expect(output).toContain('(skip) isolated Compose fixtures > mysql: qualified schema inspection')
  expect(output).toContain(
    '(skip) isolated Compose fixtures > mariadb: qualified schema inspection'
  )
}, 120_000)

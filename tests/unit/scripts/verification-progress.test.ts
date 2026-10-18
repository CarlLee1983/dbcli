import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), 'verification-progress-'))
  directories.push(directory)
  const path = join(directory, 'verify.log')
  await Bun.write(path, contents)
  return path
}

function observe(path: string, ...args: string[]) {
  return Bun.spawn([process.execPath, 'scripts/verification-progress.ts', path, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

const attestation = (result: 'PASS' | 'FAIL') =>
  `verification attestation: ${result} at ${'a'.repeat(40)} (sha256:${'b'.repeat(64)})\n`

test('one-shot reports progress without treating EOF as success or exposing raw lines', async () => {
  const path = await fixture(
    'raw query password=SECRET\n==> [1] bun install --frozen-lockfile\n' +
      '<== [1] bun install --frozen-lockfile 3s exit 0\n==> [2] password=SECRET\n'
  )
  const child = observe(path)
  const stdout = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  expect(stdout).toContain('START [1]')
  expect(stdout).toContain('END [1] 3s exit 0')
  expect(stdout).toContain('IN_PROGRESS step [2]; attestation UNKNOWN')
  expect(stdout).not.toContain('SECRET')
  expect(stdout).not.toContain('raw query')
})

test.each(['PASS', 'FAIL'] as const)(
  'reports final %s only from a complete attestation',
  async (result) => {
    const path = await fixture(
      `==> [1] bun run test\n<== [1] bun run test 4s exit ${result === 'PASS' ? 0 : 1}\n` +
        attestation(result)
    )
    const child = observe(path)
    const stdout = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(stdout).toContain(`ATTESTATION ${result}`)
    expect(stdout).toContain(`Summary: attestation ${result}`)
  }
)

test('bounds one-shot output and ignores incomplete final attestations and oversized raw lines', async () => {
  const path = await fixture(
    'SECRET'.repeat(20000) +
      '\n' +
      Array.from({ length: 200 }, (_, i) => `==> [${i + 1}] secret-command\n`).join('') +
      attestation('PASS').trimEnd()
  )
  const child = observe(path)
  const stdout = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  expect(stdout.trimEnd().split('\n')).toHaveLength(13)
  expect(stdout).toContain('IN_PROGRESS step [200]; attestation UNKNOWN')
  expect(stdout).not.toContain('SECRET')
  expect(stdout).not.toContain('secret-command')
  expect(stdout).not.toContain('PASS')
})

test('follow completes partial lines once, suppresses duplicate markers, and remains interruptible at EOF', async () => {
  const path = await fixture('==> [1] bun run test\n<== [1] bun run test 7')
  const child = observe(path, '--follow')
  let output = ''
  const reading = (async () => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output += decoder.decode(value, { stream: true })
    }
  })()
  const until = async (text: string, count = 1) => {
    const deadline = Date.now() + 3000
    while (output.split(text).length - 1 < count && Date.now() < deadline) await Bun.sleep(10)
    expect(output.split(text).length - 1).toBeGreaterThanOrEqual(count)
  }
  try {
    await until('attestation UNKNOWN')
    await Bun.write(
      path,
      (await Bun.file(path).text()) + 's exit 0\n<== [1] bun run test 7s exit 0\n'
    )
    await until('END [1] 7s exit 0')
    await Bun.write(path, (await Bun.file(path).text()) + attestation('PASS'))
    await until('ATTESTATION PASS')
    expect(child.exitCode).toBeNull()
    await Bun.write(path, (await Bun.file(path).text()) + '==> [1] bun run test\n')
    await until('START [1]\n', 2)
    child.kill('SIGINT')
    expect(await child.exited).toBe(130)
    await reading
    expect(output.match(/END \[1\]/g)).toHaveLength(1)
    expect(output.match(/ATTESTATION PASS/g)).toHaveLength(1)
    expect(output.trimEnd()).toEndWith('attestation UNKNOWN')
  } finally {
    child.kill()
    await child.exited
    await reading
  }
})

test('read failures never disclose the supplied path', async () => {
  const path = await fixture('')
  const child = observe(`${path}/password=SECRET`)
  const stderr = await new Response(child.stderr).text()
  expect(await child.exited).toBe(1)
  expect(stderr).toContain('Cannot observe log:')
  expect(stderr).not.toContain('SECRET')
})

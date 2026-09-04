/**
 * The lazy entry path, exercised through a real process.
 *
 * `buildProgramFor()` (ADR 0007) only runs in `src/cli-runtime.ts`, so nothing
 * that constructs a program in-process can observe it. The unit tests next door
 * compare *declared shape*; this file exists because a command whose behaviour
 * depends on its siblings passes those and is still broken end to end — which
 * is exactly what `completion` did: under a one-command root it emitted a
 * script listing only itself, and `--install` writes that into the user's
 * shell rc.
 */

import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const legacyBaseline = (await Bun.file(
  resolve(import.meta.dir, '../fixtures/plat004/legacy-surface-baseline.json')
).json()) as {
  baselineCommit: string
  cases: Array<{
    name: string
    args: string[]
    lang?: string
    normalizeGeneratedAt?: boolean
    exitCode: number
    stdoutSha256: string
    stderrSha256: string
  }>
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function runResult(...args: string[]) {
  return spawnSync('bun', [CLI, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
  })
}

function run(...args: string[]): string {
  const result = runResult(...args)
  expect(result.status).toBe(0)
  return result.stdout
}

function expectAgentFailure(
  result: ReturnType<typeof runResult>,
  code: string,
  exitCode: number
): void {
  expect(result.status).toBe(exitCode)
  expect(result.stderr).toBe('')
  expect(result.stdout.endsWith('\n')).toBe(true)
  expect(JSON.parse(result.stdout)).toMatchObject({
    schemaVersion: 1,
    ok: false,
    operation: 'capabilities.check',
    status: 'failed',
    context: null,
    data: null,
    warnings: [],
    evidence: [],
    recovery: null,
    error: { code },
  })
}

describe('lazy entry path', () => {
  test.each(['bash', 'zsh', 'fish'])(
    'completion %s describes the whole command tree, not just itself',
    (shell) => {
      const script = run('completion', shell)

      // A truncated script still contains `completion`; the siblings are what
      // disappears when the tree is read off this command's parent.
      for (const command of ['query', 'schema', 'list', 'export', 'impact']) {
        expect(script).toContain(command)
      }
    }
  )

  test('root help lists every top-level command', () => {
    const help = run('--help')

    for (const command of ['query', 'schema', 'list', 'export', 'impact', 'completion']) {
      expect(help).toContain(command)
    }
    expect(help).toContain('--agent-output')
    expect(help).toContain('Operation Envelope v1')
    expect(help).toContain('check only')
  })

  test('a lazily dispatched command renders its own full help', () => {
    const help = run('query', '--help')

    expect(help).toContain('Usage: dbcli query')
    for (const flag of ['--format', '--limit', '--no-limit', '--fields', '--slow-ms', '--use']) {
      expect(help).toContain(flag)
    }
  })

  test.each(legacyBaseline.cases)('$name matches the pre-PLAT-004 baseline', (fixture) => {
    expect(legacyBaseline.baselineCommit).toBe('cc7427bedbd72215ccf370911bd262ba9f315717')
    const cwd = mkdtempSync(join(tmpdir(), 'dbcli-plat004-legacy-'))
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: 'test',
        DBCLI_NO_UPDATE_CHECK: '1',
      }
      for (const key of Object.keys(env)) {
        if (key.startsWith('DBCLI_') && key !== 'DBCLI_NO_UPDATE_CHECK') delete env[key]
      }
      if (fixture.lang) env.DBCLI_LANG = fixture.lang
      const result = spawnSync('bun', [CLI, ...fixture.args], {
        cwd,
        encoding: 'utf8',
        timeout: 60_000,
        env,
      })
      const stdout = fixture.normalizeGeneratedAt
        ? result.stdout.replace(/"generatedAt": "[^"]+"/, '"generatedAt": "<generatedAt>"')
        : result.stdout

      expect(result.status).toBe(fixture.exitCode)
      expect(sha256(stdout)).toBe(fixture.stdoutSha256)
      expect(sha256(result.stderr)).toBe(fixture.stderrSha256)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('lazy entry agent-output failures', () => {
  test.each([
    ['after subcommand', ['capabilities', 'check', '--agent-output', '--require', 'schema.read']],
    [
      'explicit format',
      ['--agent-output', 'capabilities', 'check', '--require', 'schema.read', '--format', 'json'],
    ],
    [
      'for-agent conflict',
      ['--agent-output', 'capabilities', 'check', '--require', 'schema.read', '--for-agent'],
    ],
  ])('%s is an invalid option envelope', (_name, args) => {
    expectAgentFailure(runResult(...args), 'INVALID_AGENT_OUTPUT_OPTIONS', 2)
  })

  test.each([
    ['ordinary command', ['--agent-output', 'query', 'SELECT 1']],
    ['capability catalog', ['--agent-output', 'capabilities']],
    ['shell', ['--agent-output', 'shell']],
    ['es-shell', ['--agent-output', 'es-shell']],
    ['proxy', ['--agent-output', 'proxy']],
    ['help', ['--agent-output', '--help']],
    ['version', ['--agent-output', '--version']],
    [
      'clustered help',
      ['-qh', '--agent-output', 'capabilities', 'check', '--require', 'schema.read'],
    ],
    [
      'clustered version',
      ['-qV', '--agent-output', 'capabilities', 'check', '--require', 'schema.read'],
    ],
    ['no command', ['--agent-output']],
  ])('%s is rejected before its action', (_name, args) => {
    expectAgentFailure(runResult(...args), 'UNSUPPORTED_AGENT_OUTPUT_OPERATION', 2)
  })

  test('Commander requirement and option errors stay structured', () => {
    expectAgentFailure(
      runResult('--agent-output', 'capabilities', 'check', '--require'),
      'INVALID_CAPABILITY_REQUIREMENTS',
      2
    )
    expectAgentFailure(
      runResult('--agent-output', 'capabilities', 'check', '--require', 'schema.read', '--unknown'),
      'INVALID_AGENT_OUTPUT_OPTIONS',
      2
    )
    expectAgentFailure(runResult('--agent-output', '--config'), 'INVALID_AGENT_OUTPUT_OPTIONS', 2)
    expectAgentFailure(
      runResult('--agent-output', '--timeout', 'capabilities', 'check', '--require', 'schema.read'),
      'INVALID_AGENT_OUTPUT_OPTIONS',
      2
    )
  })

  test('valid clustered root flags remain accepted before the agent option', () => {
    const result = runResult(
      '-qv',
      '--agent-output',
      'capabilities',
      'check',
      '--require',
      'unknown.capability'
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout).error.code).toBe('CAPABILITY_REQUIREMENTS_UNMET')
  })

  test.each(['loader', 'action'])(
    '%s failures redact the raw error and emit one envelope',
    (kind) => {
      const lazyUrl = pathToFileURL(resolve(import.meta.dir, '../../src/program-lazy.ts')).href
      const runtimeUrl = pathToFileURL(resolve(import.meta.dir, '../../src/cli-runtime.ts')).href
      const sentinel = 'driver body: PLAT004_RAW_ERROR_SENTINEL'
      const replacement =
        kind === 'loader'
          ? `async () => { throw new Error(${JSON.stringify(sentinel)}) }`
          : `async () => {
            const { Command } = await import('commander')
            return (program) => {
              const capabilities = new Command('capabilities')
              capabilities.command('check')
                .requiredOption('--require <ids>')
                .action(() => { throw new Error(${JSON.stringify(sentinel)}) })
              program.addCommand(capabilities)
            }
          }`
      const script = `
      const { COMMAND_LOADERS } = await import(${JSON.stringify(lazyUrl)})
      COMMAND_LOADERS.capabilities = ${replacement}
      process.argv = ['bun', 'dbcli', '--agent-output', 'capabilities', 'check', '--require', 'schema.read']
      await import(${JSON.stringify(runtimeUrl)})
    `
      const cwd = mkdtempSync(join(tmpdir(), 'dbcli-plat004-failure-'))
      try {
        const result = spawnSync('bun', ['-e', script], {
          cwd,
          encoding: 'utf8',
          timeout: 60_000,
          env: { ...process.env, NODE_ENV: 'test', DBCLI_NO_UPDATE_CHECK: '1' },
        })

        expectAgentFailure(result, 'AGENT_OUTPUT_INTERNAL_ERROR', 1)
        expect(result.stdout).not.toContain(sentinel)
        expect(result.stderr).not.toContain(sentinel)
        expect(JSON.parse(result.stdout).error.message).toBe('Agent output failed safely.')
        expect(readdirSync(cwd)).toEqual([])
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    }
  )
})

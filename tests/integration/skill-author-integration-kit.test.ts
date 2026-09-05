import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  discover,
  preflight,
  type RunDbcli,
} from '../../assets/integration-kit/skill-author-consumer'
import { parseAgentTask } from '@/core/agent-tasks/parser'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function run(cwd: string): RunDbcli {
  return (args) =>
    new Promise((resolveRun) => {
      const child = spawn('bun', ['run', CLI, ...args], {
        cwd,
        env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += String(chunk)))
      child.stderr.on('data', (chunk) => (stderr += String(chunk)))
      child.on('close', (code) => resolveRun({ code: code ?? 1, stdout, stderr }))
    })
}

async function workspace(permission: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'dbcli-skill-author-kit-'))
  const config = join(cwd, 'dbcli.json')
  await writeFile(
    config,
    JSON.stringify({
      connection: {
        system: 'postgresql',
        host: '203.0.113.1',
        port: 5432,
        user: 'nobody',
        database: 'none',
      },
      permission,
      metadata: { createdAt: '2026-09-05T00:00:00.000Z', version: '1.0' },
    })
  )
  return { cwd, config }
}

describe('Skill Author Integration Kit', () => {
  test('discovers the pinned catalog and accepts a successful envelope', async () => {
    const { cwd, config } = await workspace('query-only')
    try {
      const runner = run(cwd)
      const catalog = await discover(runner)
      expect(catalog.capabilities.some(({ id }) => id === 'schema.read')).toBe(true)

      const envelope = await preflight(
        (args) => runner(['--config', config, ...args]),
        ['schema.read', 'query.read'],
        'PLAT-009'
      )
      expect(envelope.ok).toBe(true)
      expect(envelope.context?.correlationId).toBe('PLAT-009')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('keeps a completed negative result parseable instead of treating exit 1 as transport failure', async () => {
    const { cwd, config } = await workspace('query-only')
    try {
      const envelope = await preflight(
        (args) => run(cwd)(['--config', config, ...args]),
        ['data.delete'],
        'PLAT-009'
      )
      expect(envelope.ok).toBe(false)
      expect(envelope.error?.code).toBe('CAPABILITY_REQUIREMENTS_UNMET')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects a non-strict catalog response', async () => {
    await expect(
      discover(async () => ({
        code: 0,
        stdout: '{"schemaVersion":1,"capabilities":[],"extra":true}',
        stderr: '',
      }))
    ).rejects.toThrow("Unrecognized key(s) in object: 'extra'")
  })

  test('ships a plan-only Task Pack with capability requirements', async () => {
    const text = await Bun.file('assets/integration-kit/task-pack.md').text()
    const task = parseAgentTask({
      name: 'example-read-only-review',
      file: 'assets/integration-kit/task-pack.md',
      source: 'builtin',
      text,
    })
    expect(task.safety).toEqual({ mode: 'plan-only', requires: ['schema.read', 'query.read'] })
  })
})

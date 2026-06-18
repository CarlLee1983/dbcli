import { describe, test, expect, spyOn, beforeEach } from 'bun:test'
import { Command } from 'commander'
import { registerSkillTasksCommand } from '@/commands/skill-tasks'

function makeRoot(): Command {
  const program = new Command().name('dbcli').exitOverride()
  const skill = program.command('skill').description('skill')
  registerSkillTasksCommand(skill)
  return program
}

describe('builtin pack: safe-backfill-verify', () => {
  let logOut = ''
  let exitCode: number | undefined
  beforeEach(() => {
    logOut = ''
    exitCode = undefined
  })
  const logSpy = spyOn(console, 'log').mockImplementation((m: unknown) => {
    logOut += String(m) + '\n'
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number
    return undefined as never
  })

  test('appears in the builtin task list', async () => {
    const program = makeRoot()
    await program.parseAsync(['node', 'dbcli', 'skill', 'tasks', 'list', '--format', 'json'], {
      from: 'node',
    })
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"name": "safe-backfill-verify"')
  })

  test('plan emits a read-back assert step from verify_query and expect', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'safe-backfill-verify',
        '--param',
        'table=orders',
        '--param',
        'query=UPDATE orders SET status = 1 WHERE status IS NULL',
        '--param',
        'verify_query=SELECT count(*) FROM orders WHERE status IS NULL',
        '--param',
        'expect=rows == 0',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    expect(logOut).toContain('"resolvedCommand": "schema orders --format json"')
    expect(logOut).toContain(
      '"resolvedCommand": "assert \\"SELECT count(*) FROM orders WHERE status IS NULL\\" --expect \\"rows == 0\\""'
    )
  })

  test('plan includes planned verification metadata referencing the resolved assert command', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'safe-backfill-verify',
        '--param',
        'table=orders',
        '--param',
        'query=UPDATE orders SET status = 1 WHERE status IS NULL',
        '--param',
        'verify_query=SELECT count(*) FROM orders WHERE status IS NULL',
        '--param',
        'expect=rows == 0',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    expect(exitCode).toBeUndefined()
    const plan = JSON.parse(logOut)
    expect(plan.verification).toBeDefined()
    expect(plan.verification.status).toBe('planned')
    expect(plan.verification.artifactSchemaVersion).toBe(1)
    expect(plan.verification.subject).toEqual({ kind: 'backfill', name: 'safe-backfill-verify' })
    const ev = plan.verification.evidence[0]
    expect(ev.kind).toBe('assert')
    expect(ev.command).toBe(
      'assert "SELECT count(*) FROM orders WHERE status IS NULL" --expect "rows == 0"'
    )
    expect(ev.taskName).toBe('safe-backfill-verify')
    expect(ev.step).toBe(4)
  })

  test('planned verification metadata never claims a terminal status', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node',
        'dbcli',
        'skill',
        'tasks',
        'plan',
        'safe-backfill-verify',
        '--param',
        'table=orders',
        '--param',
        'query=UPDATE orders SET status = 1 WHERE status IS NULL',
        '--param',
        'verify_query=SELECT count(*) FROM orders WHERE status IS NULL',
        '--param',
        'expect=rows == 0',
        '--format',
        'json',
      ],
      { from: 'node' }
    )
    const plan = JSON.parse(logOut)
    expect(['verified', 'not_verified', 'indeterminate', 'blocked']).not.toContain(
      plan.verification.status
    )
  })

  test('agent notes do not suggest unsupported raw query dry-run', async () => {
    const pack = await Bun.file('assets/tasks/safe-backfill-verify.md').text()
    expect(pack).not.toContain('dbcli query "{{query}}" --dry-run')
    expect(pack).toContain('dbcli update <table> --where "<predicate>" --set \'<json>\' --dry-run')
  })

  test('planned verification metadata carries no result artifact path', async () => {
    const program = makeRoot()
    await program.parseAsync(
      [
        'node', 'dbcli', 'skill', 'tasks', 'plan', 'safe-backfill-verify',
        '--param', 'table=orders',
        '--param', 'query=UPDATE orders SET status = 1 WHERE status IS NULL',
        '--param', 'verify_query=SELECT count(*) FROM orders WHERE status IS NULL',
        '--param', 'expect=rows == 0',
        '--format', 'json',
      ],
      { from: 'node' }
    )
    const plan = JSON.parse(logOut)
    expect(plan.verification.status).toBe('planned')
    expect(plan.verification.verificationArtifactPath).toBeUndefined()
    expect(plan.verification.evidence[0].verificationArtifactPath).toBeUndefined()
    // planned evidence has no executed exitCode
    expect(plan.verification.evidence[0].exitCode).toBeUndefined()
  })

  void logSpy
  void exitSpy
})

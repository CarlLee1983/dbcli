import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { impactCommand } from '@/commands/impact'

function root(): Command {
  const program = new Command().name('dbcli').exitOverride().enablePositionalOptions()
  program.option('--config <path>', 'config path', '.dbcli')
  program.addCommand(impactCommand)
  return program
}

describe('impact assess command', () => {
  let sandbox = ''
  let cwd = ''
  let output = ''
  let errors = ''
  const _logSpy = spyOn(console, 'log').mockImplementation((value: unknown) => {
    output += `${String(value)}\n`
  })
  const _errorSpy = spyOn(console, 'error').mockImplementation((value: unknown) => {
    errors += `${String(value)}\n`
  })

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'dbcli-impact-command-'))
    cwd = process.cwd()
    output = ''
    errors = ''
    process.exitCode = 0
    process.chdir(sandbox)
    writeFileSync(
      join(sandbox, 'design.json'),
      JSON.stringify({
        version: 1,
        dialect: 'postgresql',
        models: [
          {
            name: 'accounts',
            table: 'accounts',
            fields: [{ name: 'id', type: 'uuid', nullable: false, primaryKey: true }],
          },
        ],
        relationships: [],
        accessPatterns: [],
        decisions: [],
      })
    )
    writeFileSync(
      join(sandbox, 'config.json'),
      JSON.stringify({
        connection: { system: 'postgresql', host: 'unreachable.invalid', port: 5432, user: 'test', database: 'app' },
        permission: 'query-only',
        blacklist: { tables: [], columns: {} },
        schema: {
          accounts: {
            name: 'accounts',
            columns: [
              { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
              { name: 'email', type: 'text', nullable: false },
            ],
            indexes: [],
          },
        },
      })
    )
    mkdirSync(join(sandbox, '.dbcli', 'queries'), { recursive: true })
    writeFileSync(join(sandbox, '.dbcli', 'queries', 'active-accounts.sql'), '-- not read by impact\n')
    writeFileSync(
      join(sandbox, 'dbcli.semantic.json'),
      JSON.stringify({
        version: 1,
        models: [
          {
            name: 'accounts',
            table: 'accounts',
            fields: [{ column: 'email' }],
          },
        ],
        metrics: [{ name: 'active-accounts', query: '@active-accounts' }],
      })
    )
    writeFileSync(
      join(sandbox, 'dbcli.contracts.json'),
      JSON.stringify({
        version: 1,
        contracts: [
          {
            name: 'account-contactability',
            status: 'approved',
            description: 'Contact availability',
            subjects: ['field:accounts.email', 'metric:active-accounts'],
            owner: 'data',
            evidencePolicy: 'verification-required',
          },
        ],
      })
    )
  })

  afterEach(() => {
    process.chdir(cwd)
    process.exitCode = 0
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  async function run(...args: string[]): Promise<void> {
    await root().parseAsync(['bun', 'dbcli', '--config', join(sandbox, 'config.json'), 'impact', 'assess', ...args], {
      from: 'node',
    })
  }

  test('assesses a cache baseline offline and writes a safe declared report', async () => {
    await run('--design', 'design.json', '--against-cache', '--output', 'impact.json', '--format', 'json')

    expect(JSON.parse(output)).toMatchObject({ path: 'impact.json', coverage: 'partial' })
    const report = await Bun.file(join(sandbox, 'impact.json')).json()
    expect(report.findings.map((finding: { code: string }) => finding.code)).toEqual([
      'AFFECTED_SEMANTIC_FIELD',
      'AFFECTED_SEMANTIC_CONTRACT',
      'AFFECTED_SAVED_QUERY',
    ])
    expect(report.coverage.gaps).toContainEqual(
      expect.objectContaining({ code: 'VERIFICATIONS_ABSENT' })
    )
    expect(JSON.stringify(report)).not.toContain('-- not read by impact')
    expect(process.exitCode).toBe(0)
  })

  test('renders Markdown when explicitly requested', async () => {
    await run('--design', 'design.json', '--against-cache', '--output', 'impact.md', '--format', 'markdown')

    expect(await Bun.file(join(sandbox, 'impact.md')).text()).toContain('# Impact assessment')
  })

  test('joins a valid declared data-access manifest without reading its source', async () => {
    mkdirSync(join(sandbox, 'src'), { recursive: true })
    writeFileSync(join(sandbox, 'src', 'accounts.ts'), '// application source is never parsed\n')
    writeFileSync(
      join(sandbox, 'dbcli.data-access.json'),
      JSON.stringify({
        version: 1,
        operations: [
          {
            name: 'accounts.lookup',
            source: 'src/accounts.ts',
            kind: 'read',
            references: ['field:accounts.email'],
            coverage: 'declared',
          },
        ],
      })
    )

    await run('--design', 'design.json', '--against-cache', '--output', 'access.json')

    const report = await Bun.file(join(sandbox, 'access.json')).json()
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'AFFECTED_DECLARED_ACCESS_OPERATION',
        severity: 'warn',
        location: { artifact: 'src/accounts.ts', selector: 'data-access:read:accounts.lookup' },
      })
    )
    expect(JSON.stringify(report)).not.toContain('application source is never parsed')
  })

  test('records an invalid optional data-access manifest as coverage without leaking its path', async () => {
    writeFileSync(
      join(sandbox, 'dbcli.data-access.json'),
      JSON.stringify({
        version: 1,
        operations: [
          { name: 'invalid', source: '../private-source.ts', kind: 'read', references: ['model:accounts'], coverage: 'declared' },
        ],
      })
    )

    await run('--design', 'design.json', '--against-cache', '--output', 'invalid-access.json')

    const report = await Bun.file(join(sandbox, 'invalid-access.json')).json()
    expect(report.coverage.gaps).toContainEqual(expect.objectContaining({ code: 'DATA_ACCESS_INVALID' }))
    expect(JSON.stringify(report)).not.toContain('private-source')
  })

  test('marks protected verification metadata as a redacted coverage gap', async () => {
    const config = await Bun.file(join(sandbox, 'config.json')).json()
    config.blacklist.columns.accounts = ['private-verification']
    await Bun.write(join(sandbox, 'config.json'), JSON.stringify(config))
    const verificationDir = join(sandbox, '.dbcli', 'verification')
    mkdirSync(verificationDir, { recursive: true })
    writeFileSync(
      join(verificationDir, 'verification-20260808-000000-private.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'ver_private_verification',
        createdAt: '2026-08-08T00:00:00.000Z',
        status: 'verified',
        subject: { kind: 'table', name: 'private-verification' },
        summary: 'not surfaced',
        evidence: [{ kind: 'manual', note: 'not surfaced' }],
      })
    )

    await run('--design', 'design.json', '--against-cache', '--output', 'redacted.json')

    const report = await Bun.file(join(sandbox, 'redacted.json')).json()
    expect(report.coverage.gaps).toContainEqual(
      expect.objectContaining({ code: 'REDACTED_PROTECTED_SUBJECT' })
    )
    expect(JSON.stringify(report)).not.toContain('private-verification')
  })

  test('writes identical findings before --fail-on changes only the exit code', async () => {
    await run('--design', 'design.json', '--against-cache', '--output', 'never.json', '--fail-on', 'never')
    const never = await Bun.file(join(sandbox, 'never.json')).text()
    output = ''
    process.exitCode = 0

    await run('--design', 'design.json', '--against-cache', '--output', 'warn.json', '--fail-on', 'warn')
    const warn = await Bun.file(join(sandbox, 'warn.json')).text()

    expect(warn).toBe(never)
    expect(process.exitCode).toBe(1)
  })

  test('rejects baseline mode errors before writing output', async () => {
    await run('--design', 'design.json', '--output', 'impact.json')

    expect(errors).toContain('Choose exactly one')
    expect(await Bun.file(join(sandbox, 'impact.json')).exists()).toBe(false)
  })

  test('rejects a symlinked output directory before creating files outside the workspace', async () => {
    const external = mkdtempSync(join(tmpdir(), 'dbcli-impact-external-'))
    try {
      symlinkSync(external, join(sandbox, 'escape'))

      await run('--design', 'design.json', '--against-cache', '--output', 'escape/new/impact.json')

      expect(errors).toContain('output path must stay inside the workspace')
      expect(existsSync(join(external, 'new'))).toBe(false)
    } finally {
      rmSync(external, { recursive: true, force: true })
    }
  })
})

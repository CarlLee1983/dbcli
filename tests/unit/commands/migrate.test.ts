/**
 * Migrate command CLI-level tests
 * Tests argument parsing, option handling, and output format
 * Uses subprocess spawning against the actual CLI to verify end-to-end behavior
 */

import { test, expect, describe } from 'bun:test'

const CWD = import.meta.dir + '/../../..'

function shellSplit(cmd: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  for (const ch of cmd) {
    if (!inQuote && (ch === '"' || ch === "'")) { inQuote = true; quoteChar = ch; continue }
    if (inQuote && ch === quoteChar) { inQuote = false; continue }
    if (!inQuote && ch === ' ') { if (current) { args.push(current); current = '' }; continue }
    current += ch
  }
  if (current) args.push(current)
  return args
}

async function run(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const argv = shellSplit(args)
  const proc = Bun.spawn(['bun', 'run', 'src/cli.ts', 'migrate', ...argv], {
    cwd: CWD,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' }
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

function parseJSON(text: string) {
  const start = text.indexOf('{')
  if (start === -1) throw new Error(`No JSON: ${text}`)
  return JSON.parse(text.substring(start))
}

// ── create ───────────────────────────────────────────────────────────────

describe('migrate create', () => {
  test('dry-run returns SQL', async () => {
    const { stdout, exitCode } = await run('create test_table --column id:serial:pk --column name:varchar(50):not-null')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.status).toBe('success')
    expect(result.dryRun).toBe(true)
    expect(result.operation).toBe('createTable')
    expect(result.sql).toContain('CREATE TABLE')
    expect(result.sql).toContain('test_table')
  })

  test('requires --column', async () => {
    const { exitCode, stderr } = await run('create test_table')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('column')
  })

  test('rejects invalid column spec', async () => {
    const { exitCode } = await run('create test_table --column invalid')
    expect(exitCode).toBe(1)
  })
})

// ── drop ─────────────────────────────────────────────────────────────────

describe('migrate drop', () => {
  test('dry-run returns DROP SQL', async () => {
    const { stdout, exitCode } = await run('drop test_table')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DROP TABLE')
  })
})

// ── add-column ───────────────────────────────────────────────────────────

describe('migrate add-column', () => {
  test('dry-run returns ALTER TABLE ADD COLUMN', async () => {
    const { stdout, exitCode } = await run('add-column users bio text --nullable')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('ADD COLUMN')
    expect(result.sql).toContain('bio')
  })

  test('with default value', async () => {
    const { stdout, exitCode } = await run('add-column users age integer --default 0')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DEFAULT 0')
  })
})

// ── drop-column ──────────────────────────────────────────────────────────

describe('migrate drop-column', () => {
  test('dry-run returns ALTER TABLE DROP COLUMN', async () => {
    const { stdout, exitCode } = await run('drop-column users bio')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DROP COLUMN')
  })
})

// ── alter-column ─────────────────────────────────────────────────────────

describe('migrate alter-column', () => {
  test('change type', async () => {
    const { stdout, exitCode } = await run('alter-column users name --type varchar(200)')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('VARCHAR(200)')
  })

  test('rename column', async () => {
    const { stdout, exitCode } = await run('alter-column users email --rename user_email')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('RENAME COLUMN')
    expect(result.sql).toContain('user_email')
  })

  test('set default', async () => {
    const { stdout, exitCode } = await run("alter-column users status --set-default active")
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DEFAULT')
  })

  test('drop default', async () => {
    const { stdout, exitCode } = await run('alter-column users bio --drop-default')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DROP DEFAULT')
  })
})

// ── add-index ────────────────────────────────────────────────────────────

describe('migrate add-index', () => {
  test('basic index', async () => {
    const { stdout, exitCode } = await run('add-index users --columns email')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('CREATE')
    expect(result.sql).toContain('INDEX')
    expect(result.sql).toContain('email')
  })

  test('unique index with custom name', async () => {
    const { stdout, exitCode } = await run('add-index users --columns email --unique --name idx_email')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('UNIQUE')
    expect(result.sql).toContain('idx_email')
  })

  test('requires --columns', async () => {
    const { exitCode, stderr } = await run('add-index users')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('columns')
  })
})

// ── drop-index ───────────────────────────────────────────────────────────

describe('migrate drop-index', () => {
  test('dry-run returns DROP INDEX', async () => {
    const { stdout, exitCode } = await run('drop-index idx_users_email')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DROP INDEX')
  })
})

// ── add-constraint ───────────────────────────────────────────────────────

describe('migrate add-constraint', () => {
  test('foreign key', async () => {
    const { stdout, exitCode } = await run('add-constraint orders --fk user_id --references users.id')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('FOREIGN KEY')
    expect(result.sql).toContain('REFERENCES')
  })

  test('FK with on-delete cascade', async () => {
    const { stdout, exitCode } = await run('add-constraint orders --fk user_id --references users.id --on-delete cascade')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('ON DELETE CASCADE')
  })

  test('unique constraint', async () => {
    const { stdout, exitCode } = await run('add-constraint users --unique email')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('UNIQUE')
  })

  test('check constraint', async () => {
    const { stdout, exitCode } = await run("add-constraint users --check \"age >= 0\"")
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('CHECK')
  })

  test('FK requires --references', async () => {
    const { exitCode, stderr } = await run('add-constraint orders --fk user_id')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('references')
  })

  test('requires at least one constraint type', async () => {
    const { exitCode, stderr } = await run('add-constraint orders')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('--fk')
  })
})

// ── drop-constraint ──────────────────────────────────────────────────────

describe('migrate drop-constraint', () => {
  test('dry-run returns DROP CONSTRAINT', async () => {
    const { stdout, exitCode } = await run('drop-constraint orders fk_orders_user_id')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.sql).toContain('DROP CONSTRAINT')
  })
})

// ── add-enum ─────────────────────────────────────────────────────────────

describe('migrate add-enum', () => {
  test('MySQL returns warning (no standalone ENUM)', async () => {
    const { stdout, exitCode } = await run('add-enum status active inactive')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    // MySQL: empty SQL + warning
    expect(result.warnings).toBeDefined()
  })
})

// ── alter-enum ───────────────────────────────────────────────────────────

describe('migrate alter-enum', () => {
  test('requires --add-value', async () => {
    const { exitCode, stderr } = await run('alter-enum status')
    expect(exitCode).toBe(1)
    expect(stderr).toContain('add-value')
  })
})

// ── drop-enum ────────────────────────────────────────────────────────────

describe('migrate drop-enum', () => {
  test('dry-run returns result', async () => {
    const { stdout, exitCode } = await run('drop-enum status')
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout)
    expect(result.status).toBe('success')
  })
})

// ── help ─────────────────────────────────────────────────────────────────

describe('migrate help', () => {
  test('shows all 12 subcommands', async () => {
    const { stdout, exitCode } = await run('--help')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('create')
    expect(stdout).toContain('drop')
    expect(stdout).toContain('add-column')
    expect(stdout).toContain('drop-column')
    expect(stdout).toContain('alter-column')
    expect(stdout).toContain('add-index')
    expect(stdout).toContain('drop-index')
    expect(stdout).toContain('add-constraint')
    expect(stdout).toContain('drop-constraint')
    expect(stdout).toContain('add-enum')
    expect(stdout).toContain('alter-enum')
    expect(stdout).toContain('drop-enum')
  })
})

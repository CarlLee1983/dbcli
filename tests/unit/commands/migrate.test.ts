/**
 * Migrate command CLI-level tests
 * Tests argument parsing, option handling, and output format
 * Uses subprocess spawning against the actual CLI to verify end-to-end behavior
 */

import { test, expect, describe } from 'bun:test'
import fs from 'fs'
import { join } from 'path'

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
  const configPath = join(CWD, 'tests/fixtures/admin.dbcli.json')
  const cliPath = join(CWD, 'src/cli.ts')
  
  // Try to use bun directly on the file if bun run is failing
  const fullArgs = ['bun', cliPath, '--quiet', 'migrate', ...argv, '--config', configPath]
  
  const proc = Bun.spawnSync(fullArgs, {
    cwd: CWD,
    env: { ...process.env, NO_COLOR: '1' }
  })

  const stdout = proc.stdout.toString().trim()
  const stderr = proc.stderr.toString().trim()
  const exitCode = proc.exitCode

  if (exitCode !== 0 && !args.includes('create test_table') && !args.includes('--help')) {
     const msg = `\n--- FAIL: migrate ${args} (exit ${exitCode}) ---\nSTDOUT: ${stdout}\nSTDERR: ${stderr}\n-----------------------------------\n`
     // Use console.log instead of fs.writeSync to see if it shows up in failed test summary
     console.log(msg)
     throw new Error(`migrate ${args} failed with exit code ${exitCode}\n${stdout}\n${stderr}`);
  }
  
  return { stdout, stderr, exitCode }
}

function parseJSON(text: string, context?: string) {
  try {
    const start = text.indexOf('{')
    if (start === -1) throw new Error(`No JSON found in output: "${text}"`)
    return JSON.parse(text.substring(start))
  } catch (e) {
    console.error(`Failed to parse JSON for ${context || 'unknown'}:`);
    console.error(`Raw output: "${text}"`);
    throw e;
  }
}

// ── create ───────────────────────────────────────────────────────────────

describe('migrate create', () => {
  test('dry-run returns SQL', async () => {
    const { stdout, exitCode, stderr } = await run('create test_table --column id:serial:pk --column name:varchar(50):not-null')
    if (exitCode !== 0) {
      console.error(`migrate create failed with exit code ${exitCode}`);
      console.error(`STDOUT: ${stdout}`);
      console.error(`STDERR: ${stderr}`);
    }
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate create')
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
    const { stdout, exitCode, stderr } = await run('drop test_table')
    if (exitCode !== 0) console.error(`migrate drop failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate drop')
    expect(result.sql).toContain('DROP TABLE')
  })
})

// ── add-column ───────────────────────────────────────────────────────────

describe('migrate add-column', () => {
  test('dry-run returns ALTER TABLE ADD COLUMN', async () => {
    const { stdout, exitCode, stderr } = await run('add-column users bio text --nullable')
    if (exitCode !== 0) console.error(`migrate add-column failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-column')
    expect(result.sql).toContain('ADD COLUMN')
    expect(result.sql).toContain('bio')
  })

  test('with default value', async () => {
    const { stdout, exitCode, stderr } = await run('add-column users age integer --default 0')
    if (exitCode !== 0) console.error(`migrate add-column default failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-column default')
    expect(result.sql).toContain('DEFAULT 0')
  })
})

// ── drop-column ──────────────────────────────────────────────────────────

describe('migrate drop-column', () => {
  test('dry-run returns ALTER TABLE DROP COLUMN', async () => {
    const { stdout, exitCode, stderr } = await run('drop-column users bio')
    if (exitCode !== 0) console.error(`migrate drop-column failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate drop-column')
    expect(result.sql).toContain('DROP COLUMN')
  })
})

// ── alter-column ─────────────────────────────────────────────────────────

describe('migrate alter-column', () => {
  test('change type', async () => {
    const { stdout, exitCode, stderr } = await run('alter-column users name --type varchar(200)')
    if (exitCode !== 0) console.error(`migrate alter-column type failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate alter-column type')
    expect(result.sql).toContain('VARCHAR(200)')
  })

  test('rename column', async () => {
    const { stdout, exitCode, stderr } = await run('alter-column users email --rename user_email')
    if (exitCode !== 0) console.error(`migrate alter-column rename failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate alter-column rename')
    expect(result.sql).toContain('RENAME COLUMN')
    expect(result.sql).toContain('user_email')
  })

  test('set default', async () => {
    const { stdout, exitCode, stderr } = await run("alter-column users status --set-default active")
    if (exitCode !== 0) console.error(`migrate alter-column set-default failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate alter-column set-default')
    expect(result.sql).toContain('DEFAULT')
  })

  test('drop default', async () => {
    const { stdout, exitCode, stderr } = await run('alter-column users bio --drop-default')
    if (exitCode !== 0) console.error(`migrate alter-column drop-default failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate alter-column drop-default')
    expect(result.sql).toContain('DROP DEFAULT')
  })
})

// ── add-index ────────────────────────────────────────────────────────────

describe('migrate add-index', () => {
  test('basic index', async () => {
    const { stdout, exitCode, stderr } = await run('add-index users --columns email')
    if (exitCode !== 0) console.error(`migrate add-index failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-index')
    expect(result.sql).toContain('CREATE')
    expect(result.sql).toContain('INDEX')
    expect(result.sql).toContain('email')
  })

  test('unique index with custom name', async () => {
    const { stdout, exitCode, stderr } = await run('add-index users --columns email --unique --name idx_email')
    if (exitCode !== 0) console.error(`migrate add-index unique failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-index unique')
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
    const { stdout, exitCode, stderr } = await run('drop-index idx_users_email')
    if (exitCode !== 0) console.error(`migrate drop-index failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate drop-index')
    expect(result.sql).toContain('DROP INDEX')
  })
})

// ── add-constraint ───────────────────────────────────────────────────────

describe('migrate add-constraint', () => {
  test('foreign key', async () => {
    const { stdout, exitCode, stderr } = await run('add-constraint orders --fk user_id --references users.id')
    if (exitCode !== 0) console.error(`migrate add-constraint fk failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-constraint fk')
    expect(result.sql).toContain('FOREIGN KEY')
    expect(result.sql).toContain('REFERENCES')
  })

  test('FK with on-delete cascade', async () => {
    const { stdout, exitCode, stderr } = await run('add-constraint orders --fk user_id --references users.id --on-delete cascade')
    if (exitCode !== 0) console.error(`migrate add-constraint cascade failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-constraint cascade')
    expect(result.sql).toContain('ON DELETE CASCADE')
  })

  test('unique constraint', async () => {
    const { stdout, exitCode, stderr } = await run('add-constraint users --unique email')
    if (exitCode !== 0) console.error(`migrate add-constraint unique failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-constraint unique')
    expect(result.sql).toContain('UNIQUE')
  })

  test('check constraint', async () => {
    const { stdout, exitCode, stderr } = await run("add-constraint users --check \"age >= 0\"")
    if (exitCode !== 0) console.error(`migrate add-constraint check failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-constraint check')
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
    const { stdout, exitCode, stderr } = await run('drop-constraint orders fk_orders_user_id')
    if (exitCode !== 0) console.error(`migrate drop-constraint failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate drop-constraint')
    expect(result.sql).toContain('DROP CONSTRAINT')
  })
})

// ── add-enum ─────────────────────────────────────────────────────────────

describe('migrate add-enum', () => {
  test('MySQL returns warning (no standalone ENUM)', async () => {
    const { stdout, exitCode, stderr } = await run('add-enum status active inactive')
    if (exitCode !== 0) console.error(`migrate add-enum failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate add-enum')
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
    const { stdout, exitCode, stderr } = await run('drop-enum status')
    if (exitCode !== 0) console.error(`migrate drop-enum failed:\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`);
    expect(exitCode).toBe(0)
    const result = parseJSON(stdout, 'migrate drop-enum')
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

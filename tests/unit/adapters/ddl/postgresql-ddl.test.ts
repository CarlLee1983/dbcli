import { test, expect, describe } from 'bun:test'
import { PostgreSQLDDLGenerator } from 'src/adapters/ddl/postgresql-ddl'
import type { ColumnDefinition } from 'src/adapters/ddl/types'

const gen = new PostgreSQLDDLGenerator()

// ── CREATE TABLE ─────────────────────────────────────────────────────────

describe('PostgreSQL createTable', () => {
  test('basic table with serial pk', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'serial', primaryKey: true, nullable: false },
      { name: 'name', type: 'varchar(50)', nullable: false }
    ]
    const { sql } = gen.createTable('users', cols)
    expect(sql).toContain('CREATE TABLE "users"')
    expect(sql).toContain('"id" SERIAL NOT NULL')
    expect(sql).toContain('"name" VARCHAR(50) NOT NULL')
    expect(sql).toContain('PRIMARY KEY ("id")')
  })

  test('table with default and unique', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'serial', primaryKey: true, nullable: false },
      { name: 'email', type: 'varchar(100)', nullable: false, unique: true },
      { name: 'created_at', type: 'timestamp', default: 'now()' }
    ]
    const { sql } = gen.createTable('accounts', cols)
    expect(sql).toContain('"email" VARCHAR(100) NOT NULL UNIQUE')
    expect(sql).toContain('DEFAULT now()')
  })

  test('table with foreign key reference', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'serial', primaryKey: true, nullable: false },
      { name: 'user_id', type: 'integer', nullable: false, references: { table: 'users', column: 'id' } }
    ]
    const { sql } = gen.createTable('orders', cols)
    expect(sql).toContain('REFERENCES "users"("id")')
  })

  test('composite primary key', () => {
    const cols: ColumnDefinition[] = [
      { name: 'user_id', type: 'integer', primaryKey: true, nullable: false },
      { name: 'role_id', type: 'integer', primaryKey: true, nullable: false }
    ]
    const { sql } = gen.createTable('user_roles', cols)
    expect(sql).toContain('PRIMARY KEY ("user_id", "role_id")')
  })
})

// ── DROP TABLE ───────────────────────────────────────────────────────────

describe('PostgreSQL dropTable', () => {
  test('generates DROP TABLE', () => {
    const { sql } = gen.dropTable('users')
    expect(sql).toBe('DROP TABLE "users";')
  })
})

// ── ADD COLUMN ───────────────────────────────────────────────────────────

describe('PostgreSQL addColumn', () => {
  test('adds nullable column', () => {
    const { sql } = gen.addColumn('users', { name: 'bio', type: 'text', nullable: true })
    expect(sql).toBe('ALTER TABLE "users" ADD COLUMN "bio" TEXT;')
  })

  test('adds not-null column with default', () => {
    const { sql } = gen.addColumn('users', { name: 'age', type: 'integer', nullable: false, default: '0' })
    expect(sql).toContain('NOT NULL')
    expect(sql).toContain('DEFAULT 0')
  })
})

// ── DROP COLUMN ──────────────────────────────────────────────────────────

describe('PostgreSQL dropColumn', () => {
  test('generates DROP COLUMN', () => {
    const { sql } = gen.dropColumn('users', 'bio')
    expect(sql).toBe('ALTER TABLE "users" DROP COLUMN "bio";')
  })
})

// ── ALTER COLUMN ─────────────────────────────────────────────────────────

describe('PostgreSQL alterColumn', () => {
  test('change type', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'name', type: 'varchar(100)' })
    expect(sql).toContain('ALTER COLUMN "name" TYPE VARCHAR(100)')
  })

  test('rename column', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'email', rename: 'user_email' })
    expect(sql).toContain('RENAME COLUMN "email" TO "user_email"')
  })

  test('set default', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'status', setDefault: "'active'" })
    expect(sql).toContain("SET DEFAULT 'active'")
  })

  test('drop default', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'bio', dropDefault: true })
    expect(sql).toContain('DROP DEFAULT')
  })

  test('set nullable (drop not null)', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'bio', setNullable: true })
    expect(sql).toContain('DROP NOT NULL')
  })

  test('drop nullable (set not null)', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'email', dropNullable: true })
    expect(sql).toContain('SET NOT NULL')
  })

  test('multiple alter operations', () => {
    const { sql } = gen.alterColumn({
      table: 'users', column: 'name',
      type: 'varchar(200)',
      setDefault: "'unknown'"
    })
    expect(sql).toContain('TYPE VARCHAR(200)')
    expect(sql).toContain("SET DEFAULT 'unknown'")
  })

  test('no operations produces warning', () => {
    const { warnings } = gen.alterColumn({ table: 'users', column: 'name' })
    expect(warnings).toContain('No alter operations specified')
  })
})

// ── INDEX ────────────────────────────────────────────────────────────────

describe('PostgreSQL addIndex', () => {
  test('basic index', () => {
    const { sql } = gen.addIndex({ table: 'users', columns: ['email'] })
    expect(sql).toContain('CREATE INDEX "idx_users_email"')
    expect(sql).toContain('ON "users"')
    expect(sql).toContain('("email")')
  })

  test('unique index', () => {
    const { sql } = gen.addIndex({ table: 'users', columns: ['email'], unique: true })
    expect(sql).toContain('CREATE UNIQUE INDEX')
  })

  test('composite index with custom name', () => {
    const { sql } = gen.addIndex({
      table: 'users', columns: ['last_name', 'first_name'],
      name: 'idx_fullname'
    })
    expect(sql).toContain('"idx_fullname"')
    expect(sql).toContain('"last_name", "first_name"')
  })

  test('index with type', () => {
    const { sql } = gen.addIndex({ table: 'docs', columns: ['content'], type: 'gin' })
    expect(sql).toContain('USING GIN')
  })
})

describe('PostgreSQL dropIndex', () => {
  test('generates DROP INDEX', () => {
    const { sql } = gen.dropIndex('idx_users_email')
    expect(sql).toBe('DROP INDEX "idx_users_email";')
  })
})

// ── CONSTRAINT ───────────────────────────────────────────────────────────

describe('PostgreSQL addConstraint', () => {
  test('foreign key', () => {
    const { sql } = gen.addConstraint({
      table: 'orders', type: 'foreign_key',
      column: 'user_id', references: { table: 'users', column: 'id' }
    })
    expect(sql).toContain('FOREIGN KEY ("user_id")')
    expect(sql).toContain('REFERENCES "users"("id")')
  })

  test('foreign key with ON DELETE CASCADE', () => {
    const { sql } = gen.addConstraint({
      table: 'orders', type: 'foreign_key',
      column: 'user_id', references: { table: 'users', column: 'id' },
      onDelete: 'cascade'
    })
    expect(sql).toContain('ON DELETE CASCADE')
  })

  test('unique constraint', () => {
    const { sql } = gen.addConstraint({
      table: 'users', type: 'unique', columns: ['email']
    })
    expect(sql).toContain('UNIQUE ("email")')
  })

  test('check constraint', () => {
    const { sql } = gen.addConstraint({
      table: 'users', type: 'check', expression: 'age >= 0'
    })
    expect(sql).toContain('CHECK (age >= 0)')
  })

  test('custom constraint name', () => {
    const { sql } = gen.addConstraint({
      table: 'users', type: 'unique', columns: ['email'],
      name: 'uq_email_custom'
    })
    expect(sql).toContain('"uq_email_custom"')
  })
})

describe('PostgreSQL dropConstraint', () => {
  test('generates DROP CONSTRAINT', () => {
    const { sql } = gen.dropConstraint('orders', 'fk_orders_user_id')
    expect(sql).toBe('ALTER TABLE "orders" DROP CONSTRAINT "fk_orders_user_id";')
  })
})

// ── ENUM ─────────────────────────────────────────────────────────────────

describe('PostgreSQL addEnum', () => {
  test('creates enum type', () => {
    const { sql } = gen.addEnum({ name: 'status', values: ['active', 'inactive', 'suspended'] })
    expect(sql).toContain('CREATE TYPE "status" AS ENUM')
    expect(sql).toContain("'active', 'inactive', 'suspended'")
  })
})

describe('PostgreSQL alterEnum', () => {
  test('adds value', () => {
    const { sql, warnings } = gen.alterEnum('status', 'archived')
    expect(sql).toContain("ADD VALUE 'archived'")
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('PostgreSQL dropEnum', () => {
  test('drops enum type', () => {
    const { sql, warnings } = gen.dropEnum('status')
    expect(sql).toBe('DROP TYPE "status";')
    expect(warnings.length).toBeGreaterThan(0)
  })
})

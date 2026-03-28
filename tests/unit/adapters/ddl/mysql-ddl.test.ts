import { test, expect, describe } from 'bun:test'
import { MySQLDDLGenerator } from 'src/adapters/ddl/mysql-ddl'
import type { ColumnDefinition } from 'src/adapters/ddl/types'

const gen = new MySQLDDLGenerator()

// ── CREATE TABLE ─────────────────────────────────────────────────────────

describe('MySQL createTable', () => {
  test('basic table with serial pk', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'serial', primaryKey: true, nullable: false },
      { name: 'name', type: 'varchar(50)', nullable: false }
    ]
    const { sql } = gen.createTable('users', cols)
    expect(sql).toContain('CREATE TABLE `users`')
    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT')
    expect(sql).toContain('`name` VARCHAR(50) NOT NULL')
    expect(sql).toContain('PRIMARY KEY (`id`)')
    expect(sql).toContain('ENGINE=InnoDB')
    expect(sql).toContain('utf8mb4')
  })

  test('table with default and unique', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'serial', primaryKey: true, nullable: false },
      { name: 'email', type: 'varchar(100)', nullable: false, unique: true },
      { name: 'created_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' }
    ]
    const { sql } = gen.createTable('accounts', cols)
    expect(sql).toContain('`email` VARCHAR(100) NOT NULL UNIQUE')
    expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP')
  })

  test('table with foreign key reference', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'serial', primaryKey: true, nullable: false },
      { name: 'user_id', type: 'integer', nullable: false, references: { table: 'users', column: 'id' } }
    ]
    const { sql } = gen.createTable('orders', cols)
    expect(sql).toContain('REFERENCES `users`(`id`)')
  })

  test('smallserial maps to SMALLINT UNSIGNED', () => {
    const cols: ColumnDefinition[] = [
      { name: 'id', type: 'smallserial', primaryKey: true, nullable: false }
    ]
    const { sql } = gen.createTable('small', cols)
    expect(sql).toContain('SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT')
  })
})

// ── DROP TABLE ───────────────────────────────────────────────────────────

describe('MySQL dropTable', () => {
  test('generates DROP TABLE', () => {
    const { sql } = gen.dropTable('users')
    expect(sql).toBe('DROP TABLE `users`;')
  })
})

// ── ADD COLUMN ───────────────────────────────────────────────────────────

describe('MySQL addColumn', () => {
  test('adds nullable column', () => {
    const { sql } = gen.addColumn('users', { name: 'bio', type: 'text', nullable: true })
    expect(sql).toBe('ALTER TABLE `users` ADD COLUMN `bio` TEXT;')
  })

  test('adds not-null column with default', () => {
    const { sql } = gen.addColumn('users', { name: 'age', type: 'integer', nullable: false, default: '0' })
    expect(sql).toContain('NOT NULL')
    expect(sql).toContain('DEFAULT 0')
  })

  test('adds column with auto-increment', () => {
    const { sql } = gen.addColumn('users', { name: 'seq', type: 'integer', autoIncrement: true })
    expect(sql).toContain('AUTO_INCREMENT')
  })
})

// ── DROP COLUMN ──────────────────────────────────────────────────────────

describe('MySQL dropColumn', () => {
  test('generates DROP COLUMN', () => {
    const { sql } = gen.dropColumn('users', 'bio')
    expect(sql).toBe('ALTER TABLE `users` DROP COLUMN `bio`;')
  })
})

// ── ALTER COLUMN ─────────────────────────────────────────────────────────

describe('MySQL alterColumn', () => {
  test('change type with MODIFY COLUMN', () => {
    const { sql, warnings } = gen.alterColumn({ table: 'users', column: 'name', type: 'varchar(100)' })
    expect(sql).toContain('MODIFY COLUMN `name` VARCHAR(100)')
    expect(warnings.length).toBeGreaterThan(0)
  })

  test('rename column', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'email', rename: 'user_email' })
    expect(sql).toContain('RENAME COLUMN `email` TO `user_email`')
  })

  test('set default', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'status', setDefault: "'active'" })
    expect(sql).toContain("SET DEFAULT 'active'")
  })

  test('drop default', () => {
    const { sql } = gen.alterColumn({ table: 'users', column: 'bio', dropDefault: true })
    expect(sql).toContain('DROP DEFAULT')
  })

  test('set nullable without type produces warning', () => {
    const { warnings } = gen.alterColumn({ table: 'users', column: 'bio', setNullable: true })
    expect(warnings.some(w => w.includes('MODIFY COLUMN'))).toBe(true)
  })

  test('type + dropNullable combined in MODIFY', () => {
    const { sql } = gen.alterColumn({
      table: 'users', column: 'email',
      type: 'varchar(200)', dropNullable: true
    })
    expect(sql).toContain('MODIFY COLUMN `email` VARCHAR(200) NOT NULL')
  })

  test('type + setDefault combined in MODIFY', () => {
    const { sql } = gen.alterColumn({
      table: 'users', column: 'status',
      type: 'varchar(20)', setDefault: "'pending'"
    })
    expect(sql).toContain("MODIFY COLUMN `status` VARCHAR(20) DEFAULT 'pending'")
  })

  test('no operations produces warning', () => {
    const { warnings } = gen.alterColumn({ table: 'users', column: 'name' })
    expect(warnings).toContain('No alter operations specified')
  })
})

// ── INDEX ────────────────────────────────────────────────────────────────

describe('MySQL addIndex', () => {
  test('basic index', () => {
    const { sql } = gen.addIndex({ table: 'users', columns: ['email'] })
    expect(sql).toContain('CREATE INDEX `idx_users_email`')
    expect(sql).toContain('ON `users`')
    expect(sql).toContain('(`email`)')
  })

  test('unique index', () => {
    const { sql } = gen.addIndex({ table: 'users', columns: ['email'], unique: true })
    expect(sql).toContain('CREATE UNIQUE INDEX')
  })

  test('index with USING type after table', () => {
    const { sql } = gen.addIndex({ table: 'users', columns: ['email'], type: 'btree' })
    expect(sql).toContain('USING BTREE')
    // MySQL: USING goes after columns
    expect(sql).toMatch(/\(`email`\)\s*USING BTREE/)
  })

  test('composite index', () => {
    const { sql } = gen.addIndex({
      table: 'users', columns: ['last_name', 'first_name'],
      name: 'idx_fullname'
    })
    expect(sql).toContain('`idx_fullname`')
    expect(sql).toContain('`last_name`, `first_name`')
  })
})

describe('MySQL dropIndex', () => {
  test('generates DROP INDEX with warning', () => {
    const { sql, warnings } = gen.dropIndex('idx_users_email')
    expect(sql).toBe('DROP INDEX `idx_users_email`;')
    expect(warnings.length).toBeGreaterThan(0)
  })
})

// ── CONSTRAINT ───────────────────────────────────────────────────────────

describe('MySQL addConstraint', () => {
  test('foreign key', () => {
    const { sql } = gen.addConstraint({
      table: 'orders', type: 'foreign_key',
      column: 'user_id', references: { table: 'users', column: 'id' }
    })
    expect(sql).toContain('FOREIGN KEY (`user_id`)')
    expect(sql).toContain('REFERENCES `users`(`id`)')
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
    expect(sql).toContain('UNIQUE (`email`)')
  })

  test('check constraint with warning', () => {
    const { sql, warnings } = gen.addConstraint({
      table: 'users', type: 'check', expression: 'age >= 0'
    })
    expect(sql).toContain('CHECK (age >= 0)')
    expect(warnings.some(w => w.includes('MySQL 8.0.16'))).toBe(true)
  })
})

describe('MySQL dropConstraint', () => {
  test('generates DROP CONSTRAINT', () => {
    const { sql } = gen.dropConstraint('orders', 'fk_orders_user_id')
    expect(sql).toBe('ALTER TABLE `orders` DROP CONSTRAINT `fk_orders_user_id`;')
  })
})

// ── ENUM ─────────────────────────────────────────────────────────────────

describe('MySQL addEnum', () => {
  test('returns empty SQL with warning (no standalone ENUM)', () => {
    const { sql, warnings } = gen.addEnum({ name: 'status', values: ['active', 'inactive'] })
    expect(sql).toBe('')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('no standalone ENUM')
  })
})

describe('MySQL alterEnum', () => {
  test('returns empty SQL with warning', () => {
    const { sql, warnings } = gen.alterEnum('status', 'archived')
    expect(sql).toBe('')
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('MySQL dropEnum', () => {
  test('returns empty SQL with warning', () => {
    const { sql, warnings } = gen.dropEnum('status')
    expect(sql).toBe('')
    expect(warnings.length).toBeGreaterThan(0)
  })
})

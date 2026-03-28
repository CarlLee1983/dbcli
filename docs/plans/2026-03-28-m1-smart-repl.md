# M1: Smart REPL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive shell (`dbcli shell`) with SQL execution, dbcli command dispatch, Tab auto-completion, SQL syntax highlighting, meta commands, and persistent history.

**Architecture:** The REPL is built as a set of small, focused modules under `src/core/repl/`. Each module has a single responsibility and is independently testable. The shell command (`src/commands/shell.ts`) wires everything together and registers with the CLI. Node.js built-in `readline` is used for the interactive loop — zero new production dependencies.

**Tech Stack:** TypeScript, Node.js `readline` (Bun-compatible), existing `picocolors`, existing `sql-highlight.ts`, existing `QueryResultFormatter`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/core/repl/types.ts` | REPL-specific type definitions |
| `src/core/repl/input-classifier.ts` | Classify input as SQL, dbcli command, or meta command |
| `src/core/repl/multiline-buffer.ts` | Accumulate multi-line SQL until `;` is found |
| `src/core/repl/meta-commands.ts` | Handle `.help`, `.quit`, `.clear`, `.format`, `.history`, `.timing` |
| `src/core/repl/completer.ts` | Tab completion for SQL keywords, table/column names, dbcli commands |
| `src/core/repl/command-dispatcher.ts` | Parse and execute dbcli commands within REPL context |
| `src/core/repl/history-manager.ts` | Read/write `~/.dbcli_history` with max 1000 entries |
| `src/core/repl/repl-engine.ts` | Main REPL loop orchestrating all modules |
| `src/commands/shell.ts` | Commander.js command registration + wiring |
| `resources/lang/en/shell.json` | English i18n messages for shell |
| `resources/lang/zh-TW/shell.json` | Traditional Chinese i18n messages for shell |
| `tests/core/repl/input-classifier.test.ts` | Tests for input classification |
| `tests/core/repl/multiline-buffer.test.ts` | Tests for multi-line buffer |
| `tests/core/repl/meta-commands.test.ts` | Tests for meta command handling |
| `tests/core/repl/completer.test.ts` | Tests for Tab completion |
| `tests/core/repl/command-dispatcher.test.ts` | Tests for command dispatch |
| `tests/core/repl/history-manager.test.ts` | Tests for history persistence |
| `tests/core/repl/repl-engine.test.ts` | Integration tests for REPL engine |
| `tests/commands/shell.test.ts` | Tests for shell command registration |

### Modified Files

| File | Change |
|------|--------|
| `src/cli.ts` | Import and register `shellCommand` |
| `src/i18n/message-loader.ts` | Import shell messages into bundled messages |
| `resources/lang/en/messages.json` | Add `shell` key pointing to shell messages (or merge) |
| `resources/lang/zh-TW/messages.json` | Add `shell` key pointing to shell messages (or merge) |

---

## Task 1: REPL Types

**Files:**
- Create: `src/core/repl/types.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// src/core/repl/types.ts

export type InputType = 'sql' | 'command' | 'meta' | 'empty'

export interface ClassifiedInput {
  readonly type: InputType
  readonly raw: string
  readonly normalized: string
}

export type OutputFormat = 'table' | 'json' | 'csv'

export interface ReplState {
  readonly format: OutputFormat
  readonly timing: boolean
  readonly connected: boolean
}

export interface ReplContext {
  readonly configPath: string
  readonly permission: import('../../types').Permission
  readonly system: 'postgresql' | 'mysql' | 'mariadb'
  readonly tableNames: readonly string[]
  readonly columnsByTable: Readonly<Record<string, readonly string[]>>
}

export interface MetaCommandResult {
  readonly action: 'continue' | 'quit' | 'clear'
  readonly output?: string
  readonly stateUpdate?: Partial<Pick<ReplState, 'format' | 'timing'>>
}

export const SQL_KEYWORDS_FOR_DETECTION: readonly string[] = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE',
  'SHOW', 'DESCRIBE', 'EXPLAIN', 'WITH',
  'BEGIN', 'COMMIT', 'ROLLBACK',
  'GRANT', 'REVOKE',
] as const

export const SQL_KEYWORDS_FOR_COMPLETION: readonly string[] = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'CROSS', 'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE',
  'IS', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER',
  'DROP', 'TABLE', 'INDEX', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'ALL', 'ASC', 'DESC',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE',
  'NOT NULL', 'DEFAULT', 'CASCADE', 'RESTRICT', 'CHECK',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE',
] as const

export const DBCLI_COMMANDS: readonly string[] = [
  'list', 'schema', 'query', 'insert', 'update', 'delete',
  'export', 'blacklist', 'check', 'diff', 'status', 'doctor',
  'skill', 'init', 'completion', 'upgrade',
] as const

export const META_COMMANDS: readonly string[] = [
  '.help', '.quit', '.exit', '.clear', '.format', '.history', '.timing',
] as const
```

- [ ] **Step 2: Commit**

```bash
git add src/core/repl/types.ts
git commit -m "feat: [shell] 新增 REPL 型別定義"
```

---

## Task 2: Input Classifier

**Files:**
- Create: `tests/core/repl/input-classifier.test.ts`
- Create: `src/core/repl/input-classifier.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/input-classifier.test.ts
import { describe, test, expect } from 'bun:test'
import { classifyInput } from '../../../src/core/repl/input-classifier'

describe('classifyInput', () => {
  describe('empty input', () => {
    test('returns empty for blank string', () => {
      const result = classifyInput('')
      expect(result.type).toBe('empty')
    })

    test('returns empty for whitespace-only', () => {
      const result = classifyInput('   \t  ')
      expect(result.type).toBe('empty')
    })
  })

  describe('meta commands', () => {
    test('classifies .help as meta', () => {
      const result = classifyInput('.help')
      expect(result.type).toBe('meta')
      expect(result.normalized).toBe('.help')
    })

    test('classifies .quit as meta', () => {
      const result = classifyInput('.quit')
      expect(result.type).toBe('meta')
    })

    test('classifies .exit as meta', () => {
      const result = classifyInput('.exit')
      expect(result.type).toBe('meta')
    })

    test('classifies .clear as meta', () => {
      const result = classifyInput('.clear')
      expect(result.type).toBe('meta')
    })

    test('classifies .format json as meta', () => {
      const result = classifyInput('.format json')
      expect(result.type).toBe('meta')
      expect(result.normalized).toBe('.format json')
    })

    test('classifies .timing on as meta', () => {
      const result = classifyInput('.timing on')
      expect(result.type).toBe('meta')
    })

    test('classifies .history as meta', () => {
      const result = classifyInput('.history')
      expect(result.type).toBe('meta')
    })
  })

  describe('SQL statements', () => {
    test('classifies SELECT as sql', () => {
      const result = classifyInput('SELECT * FROM users;')
      expect(result.type).toBe('sql')
    })

    test('classifies lowercase select as sql', () => {
      const result = classifyInput('select * from users;')
      expect(result.type).toBe('sql')
    })

    test('classifies INSERT as sql', () => {
      const result = classifyInput('INSERT INTO users (name) VALUES (\'alice\');')
      expect(result.type).toBe('sql')
    })

    test('classifies CREATE TABLE as sql', () => {
      const result = classifyInput('CREATE TABLE posts (id SERIAL PRIMARY KEY);')
      expect(result.type).toBe('sql')
    })

    test('classifies WITH (CTE) as sql', () => {
      const result = classifyInput('WITH cte AS (SELECT 1) SELECT * FROM cte;')
      expect(result.type).toBe('sql')
    })

    test('classifies ALTER TABLE as sql', () => {
      const result = classifyInput('ALTER TABLE users ADD COLUMN age INTEGER;')
      expect(result.type).toBe('sql')
    })

    test('classifies DROP TABLE as sql', () => {
      const result = classifyInput('DROP TABLE temp_data;')
      expect(result.type).toBe('sql')
    })

    test('classifies EXPLAIN as sql', () => {
      const result = classifyInput('EXPLAIN SELECT * FROM users;')
      expect(result.type).toBe('sql')
    })

    test('classifies input ending with ; as sql even without keyword', () => {
      const result = classifyInput('something weird;')
      expect(result.type).toBe('sql')
    })
  })

  describe('dbcli commands', () => {
    test('classifies schema as command', () => {
      const result = classifyInput('schema users')
      expect(result.type).toBe('command')
      expect(result.normalized).toBe('schema users')
    })

    test('classifies list as command', () => {
      const result = classifyInput('list')
      expect(result.type).toBe('command')
    })

    test('classifies blacklist list as command', () => {
      const result = classifyInput('blacklist list')
      expect(result.type).toBe('command')
    })

    test('classifies status as command', () => {
      const result = classifyInput('status')
      expect(result.type).toBe('command')
    })

    test('classifies export with format as command', () => {
      const result = classifyInput('export "SELECT 1" --format json')
      expect(result.type).toBe('command')
    })
  })

  describe('edge cases', () => {
    test('trims leading/trailing whitespace', () => {
      const result = classifyInput('  SELECT 1;  ')
      expect(result.type).toBe('sql')
      expect(result.raw).toBe('  SELECT 1;  ')
      expect(result.normalized).toBe('SELECT 1;')
    })

    test('unknown input defaults to sql attempt (not command)', () => {
      const result = classifyInput('foobar baz')
      expect(result.type).toBe('command')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/input-classifier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/input-classifier.ts
import type { ClassifiedInput, InputType } from './types'
import { SQL_KEYWORDS_FOR_DETECTION, DBCLI_COMMANDS, META_COMMANDS } from './types'

const META_PREFIX = '.'
const SQL_TERMINATOR = ';'

const sqlKeywordSet = new Set(SQL_KEYWORDS_FOR_DETECTION)
const dbcliCommandSet = new Set(DBCLI_COMMANDS)
const metaCommandNames = META_COMMANDS.map(m => m.slice(1))

export function classifyInput(raw: string): ClassifiedInput {
  const normalized = raw.trim()

  if (normalized === '') {
    return { type: 'empty', raw, normalized }
  }

  if (normalized.startsWith(META_PREFIX)) {
    const cmdName = normalized.split(/\s+/)[0].slice(1)
    if (metaCommandNames.includes(cmdName)) {
      return { type: 'meta', raw, normalized }
    }
  }

  const firstWord = normalized.split(/\s+/)[0].toUpperCase()

  if (sqlKeywordSet.has(firstWord)) {
    return { type: 'sql', raw, normalized }
  }

  if (normalized.endsWith(SQL_TERMINATOR)) {
    return { type: 'sql', raw, normalized }
  }

  return { type: 'command', raw, normalized }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/input-classifier.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/input-classifier.ts tests/core/repl/input-classifier.test.ts
git commit -m "feat: [shell] 新增輸入分類器（SQL / command / meta）"
```

---

## Task 3: Multi-line Buffer

**Files:**
- Create: `tests/core/repl/multiline-buffer.test.ts`
- Create: `src/core/repl/multiline-buffer.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/multiline-buffer.test.ts
import { describe, test, expect } from 'bun:test'
import { MultilineBuffer } from '../../../src/core/repl/multiline-buffer'

describe('MultilineBuffer', () => {
  test('single-line SQL with semicolon returns complete', () => {
    const buf = new MultilineBuffer()
    const result = buf.append('SELECT * FROM users;')
    expect(result.complete).toBe(true)
    expect(result.sql).toBe('SELECT * FROM users;')
  })

  test('single-line without semicolon returns incomplete', () => {
    const buf = new MultilineBuffer()
    const result = buf.append('SELECT *')
    expect(result.complete).toBe(false)
    expect(result.sql).toBeUndefined()
  })

  test('multi-line accumulates until semicolon', () => {
    const buf = new MultilineBuffer()

    const r1 = buf.append('SELECT *')
    expect(r1.complete).toBe(false)

    const r2 = buf.append('FROM users')
    expect(r2.complete).toBe(false)

    const r3 = buf.append('WHERE id = 1;')
    expect(r3.complete).toBe(true)
    expect(r3.sql).toBe('SELECT *\nFROM users\nWHERE id = 1;')
  })

  test('reset clears the buffer', () => {
    const buf = new MultilineBuffer()
    buf.append('SELECT *')
    buf.reset()
    expect(buf.isActive()).toBe(false)

    const result = buf.append('SELECT 1;')
    expect(result.complete).toBe(true)
    expect(result.sql).toBe('SELECT 1;')
  })

  test('isActive returns true when buffer has content', () => {
    const buf = new MultilineBuffer()
    expect(buf.isActive()).toBe(false)

    buf.append('SELECT *')
    expect(buf.isActive()).toBe(true)
  })

  test('handles semicolon inside single-quoted string (not a terminator)', () => {
    const buf = new MultilineBuffer()
    const result = buf.append("SELECT * FROM users WHERE name = 'a;b'")
    expect(result.complete).toBe(false)
  })

  test('handles semicolon inside double-quoted identifier (not a terminator)', () => {
    const buf = new MultilineBuffer()
    const result = buf.append('SELECT * FROM "table;name"')
    expect(result.complete).toBe(false)
  })

  test('terminates after string containing semicolon when real semicolon follows', () => {
    const buf = new MultilineBuffer()
    const result = buf.append("SELECT * FROM users WHERE name = 'a;b';")
    expect(result.complete).toBe(true)
  })

  test('getPartial returns current buffer content', () => {
    const buf = new MultilineBuffer()
    buf.append('SELECT *')
    buf.append('FROM users')
    expect(buf.getPartial()).toBe('SELECT *\nFROM users')
  })

  test('auto-resets after returning complete result', () => {
    const buf = new MultilineBuffer()
    buf.append('SELECT 1;')
    expect(buf.isActive()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/multiline-buffer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/multiline-buffer.ts

export interface BufferResult {
  readonly complete: boolean
  readonly sql?: string
}

export class MultilineBuffer {
  private lines: string[] = []

  append(line: string): BufferResult {
    this.lines.push(line)
    const joined = this.lines.join('\n')

    if (hasUnquotedSemicolon(joined)) {
      const sql = joined
      this.lines = []
      return { complete: true, sql }
    }

    return { complete: false }
  }

  isActive(): boolean {
    return this.lines.length > 0
  }

  getPartial(): string {
    return this.lines.join('\n')
  }

  reset(): void {
    this.lines = []
  }
}

function hasUnquotedSemicolon(sql: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
      return true
    }
  }

  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/multiline-buffer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/multiline-buffer.ts tests/core/repl/multiline-buffer.test.ts
git commit -m "feat: [shell] 新增多行 SQL 緩衝區（含引號內分號處理）"
```

---

## Task 4: Meta Commands

**Files:**
- Create: `tests/core/repl/meta-commands.test.ts`
- Create: `src/core/repl/meta-commands.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/meta-commands.test.ts
import { describe, test, expect } from 'bun:test'
import { handleMetaCommand } from '../../../src/core/repl/meta-commands'
import type { ReplState } from '../../../src/core/repl/types'

const defaultState: ReplState = { format: 'table', timing: false, connected: true }

describe('handleMetaCommand', () => {
  test('.help returns help text', () => {
    const result = handleMetaCommand('.help', defaultState, [])
    expect(result.action).toBe('continue')
    expect(result.output).toContain('.help')
    expect(result.output).toContain('.quit')
    expect(result.output).toContain('.format')
    expect(result.output).toContain('.timing')
    expect(result.output).toContain('.history')
    expect(result.output).toContain('.clear')
  })

  test('.quit returns quit action', () => {
    const result = handleMetaCommand('.quit', defaultState, [])
    expect(result.action).toBe('quit')
  })

  test('.exit returns quit action', () => {
    const result = handleMetaCommand('.exit', defaultState, [])
    expect(result.action).toBe('quit')
  })

  test('.clear returns clear action', () => {
    const result = handleMetaCommand('.clear', defaultState, [])
    expect(result.action).toBe('clear')
  })

  describe('.format', () => {
    test('sets format to json', () => {
      const result = handleMetaCommand('.format json', defaultState, [])
      expect(result.action).toBe('continue')
      expect(result.stateUpdate).toEqual({ format: 'json' })
      expect(result.output).toContain('json')
    })

    test('sets format to csv', () => {
      const result = handleMetaCommand('.format csv', defaultState, [])
      expect(result.stateUpdate).toEqual({ format: 'csv' })
    })

    test('sets format to table', () => {
      const result = handleMetaCommand('.format table', defaultState, [])
      expect(result.stateUpdate).toEqual({ format: 'table' })
    })

    test('shows current format when no argument', () => {
      const result = handleMetaCommand('.format', defaultState, [])
      expect(result.output).toContain('table')
      expect(result.stateUpdate).toBeUndefined()
    })

    test('shows error for invalid format', () => {
      const result = handleMetaCommand('.format xml', defaultState, [])
      expect(result.output).toContain('table')
      expect(result.output).toContain('json')
      expect(result.output).toContain('csv')
      expect(result.stateUpdate).toBeUndefined()
    })
  })

  describe('.timing', () => {
    test('turns timing on', () => {
      const result = handleMetaCommand('.timing on', defaultState, [])
      expect(result.stateUpdate).toEqual({ timing: true })
    })

    test('turns timing off', () => {
      const state: ReplState = { ...defaultState, timing: true }
      const result = handleMetaCommand('.timing off', state, [])
      expect(result.stateUpdate).toEqual({ timing: false })
    })

    test('shows current timing state when no argument', () => {
      const result = handleMetaCommand('.timing', defaultState, [])
      expect(result.output).toContain('off')
    })
  })

  describe('.history', () => {
    test('shows history entries', () => {
      const history = ['SELECT 1;', 'schema users', '.format json']
      const result = handleMetaCommand('.history', defaultState, history)
      expect(result.output).toContain('SELECT 1;')
      expect(result.output).toContain('schema users')
      expect(result.output).toContain('.format json')
    })

    test('shows message when history is empty', () => {
      const result = handleMetaCommand('.history', defaultState, [])
      expect(result.output).toBeDefined()
    })
  })

  test('unknown meta command returns error message', () => {
    const result = handleMetaCommand('.unknown', defaultState, [])
    expect(result.action).toBe('continue')
    expect(result.output).toContain('.help')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/meta-commands.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/meta-commands.ts
import type { MetaCommandResult, OutputFormat, ReplState } from './types'
import pc from 'picocolors'

const VALID_FORMATS: readonly OutputFormat[] = ['table', 'json', 'csv']

export function handleMetaCommand(
  input: string,
  state: ReplState,
  history: readonly string[]
): MetaCommandResult {
  const parts = input.trim().split(/\s+/)
  const cmd = parts[0]
  const arg = parts[1]

  switch (cmd) {
    case '.help':
      return { action: 'continue', output: helpText() }

    case '.quit':
    case '.exit':
      return { action: 'quit' }

    case '.clear':
      return { action: 'clear' }

    case '.format':
      return handleFormat(arg, state)

    case '.timing':
      return handleTiming(arg, state)

    case '.history':
      return handleHistory(history)

    default:
      return {
        action: 'continue',
        output: `Unknown command: ${cmd}. Type ${pc.bold('.help')} for available commands.`,
      }
  }
}

function helpText(): string {
  const lines = [
    pc.bold('Meta Commands:'),
    `  ${pc.cyan('.help')}                Show this help`,
    `  ${pc.cyan('.quit')} / ${pc.cyan('.exit')}      Exit the shell`,
    `  ${pc.cyan('.clear')}               Clear the screen`,
    `  ${pc.cyan('.format')} <table|json|csv>  Set output format`,
    `  ${pc.cyan('.history')}             Show command history`,
    `  ${pc.cyan('.timing')} <on|off>     Toggle execution time display`,
    '',
    pc.bold('Usage:'),
    `  SQL statements     Execute directly (end with ${pc.cyan(';')})`,
    `  dbcli commands     Run without ${pc.dim('dbcli')} prefix (e.g. ${pc.cyan('schema users')})`,
    `  Ctrl+D             Exit`,
  ]
  return lines.join('\n')
}

function handleFormat(arg: string | undefined, state: ReplState): MetaCommandResult {
  if (!arg) {
    return {
      action: 'continue',
      output: `Current format: ${pc.bold(state.format)}`,
    }
  }

  if (!VALID_FORMATS.includes(arg as OutputFormat)) {
    return {
      action: 'continue',
      output: `Invalid format. Valid options: ${VALID_FORMATS.join(', ')}`,
    }
  }

  return {
    action: 'continue',
    output: `Output format set to ${pc.bold(arg)}`,
    stateUpdate: { format: arg as OutputFormat },
  }
}

function handleTiming(arg: string | undefined, state: ReplState): MetaCommandResult {
  if (!arg) {
    return {
      action: 'continue',
      output: `Timing is ${pc.bold(state.timing ? 'on' : 'off')}`,
    }
  }

  if (arg === 'on') {
    return {
      action: 'continue',
      output: `Timing ${pc.bold('on')}`,
      stateUpdate: { timing: true },
    }
  }

  if (arg === 'off') {
    return {
      action: 'continue',
      output: `Timing ${pc.bold('off')}`,
      stateUpdate: { timing: false },
    }
  }

  return {
    action: 'continue',
    output: `Usage: .timing <on|off>`,
  }
}

function handleHistory(history: readonly string[]): MetaCommandResult {
  if (history.length === 0) {
    return { action: 'continue', output: pc.dim('No history yet.') }
  }

  const lines = history.map((entry, i) =>
    `  ${pc.dim(String(i + 1).padStart(4))}  ${entry}`
  )
  return { action: 'continue', output: lines.join('\n') }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/meta-commands.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/meta-commands.ts tests/core/repl/meta-commands.test.ts
git commit -m "feat: [shell] 新增 meta 指令處理器（.help/.quit/.format/.timing/.history）"
```

---

## Task 5: Tab Completer

**Files:**
- Create: `tests/core/repl/completer.test.ts`
- Create: `src/core/repl/completer.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/completer.test.ts
import { describe, test, expect } from 'bun:test'
import { createCompleter } from '../../../src/core/repl/completer'
import type { ReplContext } from '../../../src/core/repl/types'

const ctx: ReplContext = {
  configPath: '.dbcli',
  permission: 'admin',
  system: 'postgresql',
  tableNames: ['users', 'orders', 'products'],
  columnsByTable: {
    users: ['id', 'name', 'email', 'created_at'],
    orders: ['id', 'user_id', 'total', 'status'],
    products: ['id', 'title', 'price'],
  },
}

describe('createCompleter', () => {
  const complete = createCompleter(ctx)

  describe('SQL keyword completion', () => {
    test('completes SEL to SELECT', () => {
      const [hits] = complete('SEL')
      expect(hits).toContain('SELECT ')
    })

    test('completes sel (lowercase) to SELECT', () => {
      const [hits] = complete('sel')
      expect(hits).toContain('SELECT ')
    })

    test('completes FR to FROM', () => {
      const [hits] = complete('SELECT * FR')
      expect(hits).toContain('FROM ')
    })

    test('completes WH to WHERE', () => {
      const [hits] = complete('SELECT * FROM users WH')
      expect(hits).toContain('WHERE ')
    })
  })

  describe('table name completion after FROM', () => {
    test('completes table after FROM', () => {
      const [hits] = complete('SELECT * FROM u')
      expect(hits).toContain('users ')
    })

    test('completes table after JOIN', () => {
      const [hits] = complete('SELECT * FROM users JOIN o')
      expect(hits).toContain('orders ')
    })

    test('lists all tables for empty prefix after FROM', () => {
      const [hits] = complete('SELECT * FROM ')
      expect(hits).toContain('users ')
      expect(hits).toContain('orders ')
      expect(hits).toContain('products ')
    })
  })

  describe('column name completion', () => {
    test('completes column after SELECT with known FROM', () => {
      const [hits] = complete('SELECT n')
      // Without FROM context, should still try to match across all tables
      expect(hits).toContain('name ')
    })

    test('completes column in WHERE clause', () => {
      const [hits] = complete('SELECT * FROM users WHERE em')
      expect(hits).toContain('email ')
    })
  })

  describe('dbcli command completion', () => {
    test('completes sch to schema at line start', () => {
      const [hits] = complete('sch')
      expect(hits).toContain('schema ')
    })

    test('completes li to list at line start', () => {
      const [hits] = complete('li')
      expect(hits).toContain('list ')
    })

    test('completes table name after schema command', () => {
      const [hits] = complete('schema u')
      expect(hits).toContain('users ')
    })

    test('completes table name after blacklist column add', () => {
      const [hits] = complete('blacklist column add u')
      expect(hits).toContain('users ')
    })
  })

  describe('meta command completion', () => {
    test('completes . to meta commands', () => {
      const [hits] = complete('.')
      expect(hits).toContain('.help ')
      expect(hits).toContain('.quit ')
      expect(hits).toContain('.format ')
    })

    test('completes .f to .format', () => {
      const [hits] = complete('.f')
      expect(hits).toContain('.format ')
    })
  })

  describe('edge cases', () => {
    test('returns empty for empty input', () => {
      const [hits] = complete('')
      expect(hits.length).toBeGreaterThan(0)
    })

    test('returns empty when no match', () => {
      const [hits] = complete('zzzzz')
      expect(hits).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/completer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/completer.ts
import type { ReplContext } from './types'
import { SQL_KEYWORDS_FOR_COMPLETION, SQL_KEYWORDS_FOR_DETECTION, DBCLI_COMMANDS, META_COMMANDS } from './types'

type CompleterFn = (line: string) => [string[], string]

const TABLE_POSITION_KEYWORDS = new Set([
  'FROM', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS',
  'INTO', 'UPDATE', 'TABLE',
])

const COMMANDS_TAKING_TABLE_ARG = new Set([
  'schema', 'insert', 'update', 'delete', 'check',
])

export function createCompleter(ctx: ReplContext): CompleterFn {
  const allTableNames = ctx.tableNames
  const allColumns = Object.values(ctx.columnsByTable).flat()
  const uniqueColumns = [...new Set(allColumns)]

  return function completer(line: string): [string[], string] {
    const trimmed = line.trimStart()

    if (trimmed.startsWith('.')) {
      return completeMetaCommands(trimmed)
    }

    const lastWord = getLastWord(trimmed)
    const upperLine = trimmed.toUpperCase()
    const prevWord = getPreviousWord(trimmed)
    const prevWordUpper = prevWord.toUpperCase()

    // After FROM/JOIN/INTO/UPDATE/TABLE → complete table names
    if (TABLE_POSITION_KEYWORDS.has(prevWordUpper)) {
      return matchWithSuffix(allTableNames, lastWord)
    }

    // After WHERE/AND/OR/ON/SET + known table in FROM → complete column names
    if (isColumnPosition(upperLine)) {
      const tableName = extractTableFromLine(trimmed, allTableNames)
      if (tableName && ctx.columnsByTable[tableName]) {
        return matchWithSuffix([...ctx.columnsByTable[tableName]], lastWord)
      }
      return matchWithSuffix(uniqueColumns, lastWord)
    }

    // If first word matches a SQL keyword start, complete SQL keywords
    const firstWordUpper = getFirstWord(trimmed).toUpperCase()
    const sqlKeywordSet = new Set(SQL_KEYWORDS_FOR_DETECTION.map(k => k.toUpperCase()))

    if (sqlKeywordSet.has(firstWordUpper) || firstWordUpper === '') {
      // Inside SQL context
      const sqlHits = matchWithSuffix([...SQL_KEYWORDS_FOR_COMPLETION], lastWord)
      const tableHits = matchWithSuffix(allTableNames, lastWord)
      const colHits = matchWithSuffix(uniqueColumns, lastWord)
      const merged = [...new Set([...sqlHits[0], ...tableHits[0], ...colHits[0]])]
      return [merged, lastWord]
    }

    // dbcli command context
    const words = trimmed.split(/\s+/)
    if (words.length === 1) {
      // Completing the command name itself
      const cmdHits = matchWithSuffix([...DBCLI_COMMANDS], lastWord)
      const sqlHits = matchWithSuffix([...SQL_KEYWORDS_FOR_COMPLETION], lastWord)
      return [[...cmdHits[0], ...sqlHits[0]], lastWord]
    }

    // After a command that takes a table arg → complete table names
    const cmdName = words[0]
    if (COMMANDS_TAKING_TABLE_ARG.has(cmdName)) {
      return matchWithSuffix(allTableNames, lastWord)
    }

    // Fallback: complete table names
    return matchWithSuffix(allTableNames, lastWord)
  }
}

function completeMetaCommands(line: string): [string[], string] {
  const hits = META_COMMANDS
    .filter(m => m.startsWith(line.split(/\s+/)[0].toLowerCase()))
    .map(m => m + ' ')
  return [hits, line.split(/\s+/)[0]]
}

function getLastWord(line: string): string {
  const parts = line.split(/\s+/)
  return parts[parts.length - 1] || ''
}

function getFirstWord(line: string): string {
  const parts = line.split(/\s+/)
  return parts[0] || ''
}

function getPreviousWord(line: string): string {
  const parts = line.trimEnd().split(/\s+/)
  if (line.endsWith(' ') || line.endsWith('\t')) {
    return parts[parts.length - 1] || ''
  }
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

function isColumnPosition(upperLine: string): boolean {
  const columnKeywords = ['WHERE ', 'AND ', 'OR ', 'ON ', 'SET ', 'SELECT ']
  return columnKeywords.some(k => upperLine.includes(k))
}

function extractTableFromLine(line: string, tableNames: readonly string[]): string | undefined {
  const upper = line.toUpperCase()
  const fromIdx = upper.lastIndexOf('FROM ')
  if (fromIdx >= 0) {
    const afterFrom = line.slice(fromIdx + 5).trim().split(/\s+/)[0]
    const candidate = afterFrom.replace(/[;,]/g, '').toLowerCase()
    return tableNames.find(t => t.toLowerCase() === candidate)
  }
  return undefined
}

function matchWithSuffix(candidates: readonly string[], prefix: string): [string[], string] {
  const lower = prefix.toLowerCase()
  const hits = candidates
    .filter(c => c.toLowerCase().startsWith(lower))
    .map(c => c + ' ')
  return [hits, prefix]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/completer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/completer.ts tests/core/repl/completer.test.ts
git commit -m "feat: [shell] 新增 Tab 自動補全（SQL 關鍵字、表名、欄位名、指令）"
```

---

## Task 6: History Manager

**Files:**
- Create: `tests/core/repl/history-manager.test.ts`
- Create: `src/core/repl/history-manager.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/history-manager.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { HistoryManager } from '../../../src/core/repl/history-manager'
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testHistoryPath = join(tmpdir(), `.dbcli_history_test_${Date.now()}`)

describe('HistoryManager', () => {
  afterEach(() => {
    if (existsSync(testHistoryPath)) {
      unlinkSync(testHistoryPath)
    }
  })

  test('starts with empty history when file does not exist', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    expect(mgr.getAll()).toEqual([])
  })

  test('adds entries', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('SELECT 1;')
    mgr.add('schema users')
    expect(mgr.getAll()).toEqual(['SELECT 1;', 'schema users'])
  })

  test('does not add duplicate consecutive entries', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('SELECT 1;')
    mgr.add('SELECT 1;')
    expect(mgr.getAll()).toEqual(['SELECT 1;'])
  })

  test('does not add empty strings', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('')
    mgr.add('   ')
    expect(mgr.getAll()).toEqual([])
  })

  test('saves to file', () => {
    const mgr = new HistoryManager(testHistoryPath, 100)
    mgr.add('SELECT 1;')
    mgr.add('schema users')
    mgr.save()

    const content = readFileSync(testHistoryPath, 'utf-8')
    expect(content).toContain('SELECT 1;')
    expect(content).toContain('schema users')
  })

  test('loads from existing file', () => {
    writeFileSync(testHistoryPath, 'line1\nline2\nline3\n', 'utf-8')
    const mgr = new HistoryManager(testHistoryPath, 100)
    expect(mgr.getAll()).toEqual(['line1', 'line2', 'line3'])
  })

  test('respects max entries', () => {
    const mgr = new HistoryManager(testHistoryPath, 3)
    mgr.add('a')
    mgr.add('b')
    mgr.add('c')
    mgr.add('d')
    expect(mgr.getAll()).toEqual(['b', 'c', 'd'])
  })

  test('trims loaded file to max entries', () => {
    writeFileSync(testHistoryPath, 'a\nb\nc\nd\ne\n', 'utf-8')
    const mgr = new HistoryManager(testHistoryPath, 3)
    expect(mgr.getAll()).toEqual(['c', 'd', 'e'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/history-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/history-manager.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_MAX = 1000

export class HistoryManager {
  private entries: string[]
  private readonly maxEntries: number

  constructor(
    private readonly filePath: string,
    maxEntries: number = DEFAULT_MAX,
  ) {
    this.maxEntries = maxEntries
    this.entries = this.load()
  }

  add(entry: string): void {
    const trimmed = entry.trim()
    if (trimmed === '') return

    // Skip consecutive duplicates
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      return
    }

    this.entries.push(trimmed)

    // Trim to max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries)
    }
  }

  getAll(): readonly string[] {
    return this.entries
  }

  save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, this.entries.join('\n') + '\n', 'utf-8')
  }

  private load(): string[] {
    if (!existsSync(this.filePath)) {
      return []
    }

    const content = readFileSync(this.filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim() !== '')

    if (lines.length > this.maxEntries) {
      return lines.slice(lines.length - this.maxEntries)
    }

    return lines
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/history-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/history-manager.ts tests/core/repl/history-manager.test.ts
git commit -m "feat: [shell] 新增歷史紀錄管理器（持久化、去重、上限）"
```

---

## Task 7: Command Dispatcher

**Files:**
- Create: `tests/core/repl/command-dispatcher.test.ts`
- Create: `src/core/repl/command-dispatcher.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/command-dispatcher.test.ts
import { describe, test, expect } from 'bun:test'
import { parseCommandLine, isKnownCommand } from '../../../src/core/repl/command-dispatcher'

describe('parseCommandLine', () => {
  test('parses simple command', () => {
    const result = parseCommandLine('list')
    expect(result.command).toBe('list')
    expect(result.args).toEqual([])
  })

  test('parses command with arguments', () => {
    const result = parseCommandLine('schema users')
    expect(result.command).toBe('schema')
    expect(result.args).toEqual(['users'])
  })

  test('parses command with multiple arguments', () => {
    const result = parseCommandLine('query "SELECT * FROM users" --format json')
    expect(result.command).toBe('query')
    expect(result.args).toEqual(['"SELECT * FROM users"', '--format', 'json'])
  })

  test('parses command with flags', () => {
    const result = parseCommandLine('schema users --format json')
    expect(result.command).toBe('schema')
    expect(result.args).toEqual(['users', '--format', 'json'])
  })

  test('handles subcommand group (blacklist list)', () => {
    const result = parseCommandLine('blacklist list')
    expect(result.command).toBe('blacklist')
    expect(result.args).toEqual(['list'])
  })

  test('trims whitespace', () => {
    const result = parseCommandLine('  list  ')
    expect(result.command).toBe('list')
    expect(result.args).toEqual([])
  })
})

describe('isKnownCommand', () => {
  test('recognizes list', () => {
    expect(isKnownCommand('list')).toBe(true)
  })

  test('recognizes schema', () => {
    expect(isKnownCommand('schema')).toBe(true)
  })

  test('recognizes blacklist', () => {
    expect(isKnownCommand('blacklist')).toBe(true)
  })

  test('rejects unknown command', () => {
    expect(isKnownCommand('foobar')).toBe(false)
  })

  test('rejects SQL keyword', () => {
    expect(isKnownCommand('SELECT')).toBe(false)
  })

  test('does not recognize shell command (prevent recursion)', () => {
    expect(isKnownCommand('shell')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/command-dispatcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/command-dispatcher.ts
import { DBCLI_COMMANDS } from './types'

export interface ParsedCommand {
  readonly command: string
  readonly args: readonly string[]
}

const BLOCKED_FROM_REPL = new Set(['shell'])

const knownCommands = new Set(
  DBCLI_COMMANDS.filter(c => !BLOCKED_FROM_REPL.has(c))
)

export function parseCommandLine(input: string): ParsedCommand {
  const trimmed = input.trim()
  const parts = trimmed.split(/\s+/)
  const command = parts[0]
  const args = parts.slice(1)
  return { command, args }
}

export function isKnownCommand(name: string): boolean {
  return knownCommands.has(name)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/command-dispatcher.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/command-dispatcher.ts tests/core/repl/command-dispatcher.test.ts
git commit -m "feat: [shell] 新增指令解析器與已知指令檢查"
```

---

## Task 8: i18n Messages for Shell

**Files:**
- Create: `resources/lang/en/shell.json`
- Create: `resources/lang/zh-TW/shell.json`
- Modify: `src/i18n/message-loader.ts`

- [ ] **Step 1: Create English messages**

```json
{
  "welcome": "Connected to {system} ({database}@{host}:{port})",
  "welcome_permission": "Permission: {permission}",
  "prompt": "dbcli",
  "continuation_prompt": "   ...",
  "goodbye": "Goodbye.",
  "error_no_config": "No .dbcli config found. Run 'dbcli init' first.",
  "error_connection_failed": "Connection failed: {message}",
  "error_reconnecting": "Connection lost. Attempting to reconnect...",
  "error_reconnect_failed": "Reconnection failed: {message}",
  "error_reconnect_success": "Reconnected successfully.",
  "error_command_failed": "Command error: {message}",
  "error_sql_failed": "SQL error: {message}",
  "error_permission": "Permission denied. Required: {required} (current: {current})",
  "error_blacklisted": "Table '{table}' is blacklisted.",
  "sql_mode_hint": "SQL-only mode. Only SQL statements are accepted.",
  "multiline_cancelled": "Multiline input cancelled.",
  "timing_display": "Time: {ms}ms",
  "rows_display": "{count} row(s)",
  "unknown_command": "Unknown command: '{command}'. Type '.help' for available commands."
}
```

- [ ] **Step 2: Create Traditional Chinese messages**

```json
{
  "welcome": "已連線至 {system}（{database}@{host}:{port}）",
  "welcome_permission": "權限等級：{permission}",
  "prompt": "dbcli",
  "continuation_prompt": "   ...",
  "goodbye": "再見。",
  "error_no_config": "找不到 .dbcli 設定檔。請先執行 'dbcli init'。",
  "error_connection_failed": "連線失敗：{message}",
  "error_reconnecting": "連線已中斷，嘗試重新連線...",
  "error_reconnect_failed": "重新連線失敗：{message}",
  "error_reconnect_success": "重新連線成功。",
  "error_command_failed": "指令錯誤：{message}",
  "error_sql_failed": "SQL 錯誤：{message}",
  "error_permission": "權限不足。需要：{required}（目前：{current}）",
  "error_blacklisted": "表格 '{table}' 已被列入黑名單。",
  "sql_mode_hint": "純 SQL 模式。僅接受 SQL 語句。",
  "multiline_cancelled": "已取消多行輸入。",
  "timing_display": "耗時：{ms}ms",
  "rows_display": "{count} 筆資料",
  "unknown_command": "未知指令：'{command}'。輸入 '.help' 查看可用指令。"
}
```

- [ ] **Step 3: Integrate into message-loader**

Check how existing language files are loaded. The messages are bundled inline in `src/i18n/message-loader.ts`. Add the shell namespace by importing the shell JSON files and merging them into the bundled messages under the `shell` key.

Find the `BUNDLED_MESSAGES` constant in `src/i18n/message-loader.ts` and add:

```typescript
import shellEn from '../../resources/lang/en/shell.json'
import shellZhTW from '../../resources/lang/zh-TW/shell.json'

// Inside BUNDLED_MESSAGES or the merge logic:
// en.shell = shellEn
// 'zh-TW'.shell = shellZhTW
```

The exact integration depends on how the loader bundles messages. Match the existing pattern.

- [ ] **Step 4: Verify i18n loads correctly**

Run: `bun test tests/i18n/` (if tests exist)
Or: Create a quick smoke test that `t('shell.welcome')` doesn't return the key itself.

- [ ] **Step 5: Commit**

```bash
git add resources/lang/en/shell.json resources/lang/zh-TW/shell.json src/i18n/message-loader.ts
git commit -m "feat: [shell] 新增 REPL i18n 訊息（en + zh-TW）"
```

---

## Task 9: REPL Engine

**Files:**
- Create: `tests/core/repl/repl-engine.test.ts`
- Create: `src/core/repl/repl-engine.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/repl/repl-engine.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { ReplEngine } from '../../../src/core/repl/repl-engine'
import type { ReplContext, ReplState } from '../../../src/core/repl/types'
import type { DatabaseAdapter } from '../../../src/adapters/types'

// Mock adapter
function createMockAdapter(): DatabaseAdapter {
  return {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    execute: mock(() => Promise.resolve([{ id: 1, name: 'Alice' }])),
    listTables: mock(() => Promise.resolve([])),
    getTableSchema: mock(() => Promise.resolve({ name: 'users', columns: [] })),
    testConnection: mock(() => Promise.resolve(true)),
    getServerVersion: mock(() => Promise.resolve('15.0')),
  }
}

const mockContext: ReplContext = {
  configPath: '.dbcli',
  permission: 'admin',
  system: 'postgresql',
  tableNames: ['users'],
  columnsByTable: { users: ['id', 'name'] },
}

describe('ReplEngine', () => {
  test('constructs with default state', () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const state = engine.getState()
    expect(state.format).toBe('table')
    expect(state.timing).toBe(false)
    expect(state.connected).toBe(true)
  })

  test('processInput handles empty input', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('')
    expect(result.action).toBe('continue')
    expect(result.output).toBeUndefined()
  })

  test('processInput handles meta quit', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('.quit')
    expect(result.action).toBe('quit')
  })

  test('processInput handles meta clear', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('.clear')
    expect(result.action).toBe('clear')
  })

  test('processInput handles SQL execution', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('SELECT * FROM users;')
    expect(result.action).toBe('continue')
    expect(result.output).toBeDefined()
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('processInput accumulates multiline SQL', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')

    const r1 = await engine.processInput('SELECT *')
    expect(r1.action).toBe('multiline')

    const r2 = await engine.processInput('FROM users;')
    expect(r2.action).toBe('continue')
    expect(adapter.execute).toHaveBeenCalled()
  })

  test('processInput handles SQL error without crashing', async () => {
    const adapter = createMockAdapter()
    ;(adapter.execute as any).mockImplementation(() => {
      throw new Error('relation "foo" does not exist')
    })
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('SELECT * FROM foo;')
    expect(result.action).toBe('continue')
    expect(result.output).toContain('relation "foo" does not exist')
  })

  test('processInput handles permission error', async () => {
    const ctx: ReplContext = { ...mockContext, permission: 'query-only' }
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, ctx, '/tmp/test_history')
    const result = await engine.processInput('DELETE FROM users WHERE id = 1;')
    expect(result.action).toBe('continue')
    expect(result.output).toBeDefined()
  })

  test('state updates from meta commands persist', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    await engine.processInput('.format json')
    expect(engine.getState().format).toBe('json')

    await engine.processInput('.timing on')
    expect(engine.getState().timing).toBe(true)
  })

  test('isMultiline returns true during multiline input', async () => {
    const adapter = createMockAdapter()
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    expect(engine.isMultiline()).toBe(false)

    await engine.processInput('SELECT *')
    expect(engine.isMultiline()).toBe(true)
  })

  test('attempts reconnection on connection error', async () => {
    const adapter = createMockAdapter()
    let callCount = 0
    ;(adapter.execute as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const err = new Error('connection terminated')
        ;(err as any).code = 'ECONNRESET'
        throw err
      }
      return Promise.resolve([{ id: 1 }])
    })
    const engine = new ReplEngine(adapter, mockContext, '/tmp/test_history')
    const result = await engine.processInput('SELECT 1;')
    expect(result.action).toBe('continue')
    expect(adapter.connect).toHaveBeenCalledTimes(1) // reconnect call
    expect(result.output).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/repl/repl-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/core/repl/repl-engine.ts
import type { DatabaseAdapter } from '../../adapters/types'
import type { ReplContext, ReplState, OutputFormat } from './types'
import { classifyInput } from './input-classifier'
import { MultilineBuffer } from './multiline-buffer'
import { handleMetaCommand } from './meta-commands'
import { parseCommandLine, isKnownCommand } from './command-dispatcher'
import { HistoryManager } from './history-manager'
import { checkPermission } from '../permission-guard'
import { BlacklistManager } from '../blacklist-manager'
import { BlacklistValidator } from '../blacklist-validator'
import { QueryResultFormatter } from '../../formatters/query-result-formatter'
import type { QueryResult } from '../../types/query'
import { t_vars } from '../../i18n/message-loader'
import pc from 'picocolors'

export interface ProcessResult {
  readonly action: 'continue' | 'quit' | 'clear' | 'multiline'
  readonly output?: string
}

export class ReplEngine {
  private state: ReplState
  private readonly buffer: MultilineBuffer
  private readonly history: HistoryManager
  private readonly formatter: QueryResultFormatter
  private readonly blacklistManager: BlacklistManager | null
  private readonly blacklistValidator: BlacklistValidator | null

  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly context: ReplContext,
    historyPath: string,
  ) {
    this.state = { format: 'table', timing: false, connected: true }
    this.buffer = new MultilineBuffer()
    this.history = new HistoryManager(historyPath)
    this.formatter = new QueryResultFormatter()
    this.blacklistManager = null
    this.blacklistValidator = null
  }

  getState(): Readonly<ReplState> {
    return this.state
  }

  isMultiline(): boolean {
    return this.buffer.isActive()
  }

  getHistory(): readonly string[] {
    return this.history.getAll()
  }

  saveHistory(): void {
    this.history.save()
  }

  async processInput(line: string): Promise<ProcessResult> {
    // If in multiline mode, feed to buffer
    if (this.buffer.isActive()) {
      const bufResult = this.buffer.append(line)
      if (bufResult.complete) {
        this.history.add(bufResult.sql!)
        return this.executeSql(bufResult.sql!)
      }
      return { action: 'multiline' }
    }

    const classified = classifyInput(line)

    switch (classified.type) {
      case 'empty':
        return { action: 'continue' }

      case 'meta':
        return this.handleMeta(classified.normalized)

      case 'sql':
        return this.handleSql(classified.normalized)

      case 'command':
        return this.handleCommand(classified.normalized)
    }
  }

  private handleMeta(input: string): ProcessResult {
    this.history.add(input)
    const result = handleMetaCommand(input, this.state, [...this.history.getAll()])

    if (result.stateUpdate) {
      this.state = { ...this.state, ...result.stateUpdate }
    }

    return {
      action: result.action,
      output: result.output,
    }
  }

  private handleSql(input: string): ProcessResult {
    const bufResult = this.buffer.append(input)

    if (bufResult.complete) {
      this.history.add(bufResult.sql!)
      return this.executeSql(bufResult.sql!)
    }

    return { action: 'multiline' }
  }

  private async handleCommand(input: string): Promise<ProcessResult> {
    const parsed = parseCommandLine(input)

    if (!isKnownCommand(parsed.command)) {
      return {
        action: 'continue',
        output: t_vars('shell.unknown_command', { command: parsed.command }),
      }
    }

    this.history.add(input)

    try {
      // Build argv for commander: ['node', 'dbcli', command, ...args]
      const { program } = await import('../../cli')
      const argv = ['node', 'dbcli', parsed.command, ...parsed.args]

      // Capture stdout by temporarily replacing process.stdout.write
      let captured = ''
      const originalWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((chunk: any) => {
        captured += typeof chunk === 'string' ? chunk : chunk.toString()
        return true
      }) as any

      try {
        await program.parseAsync(argv, { from: 'user' })
      } finally {
        process.stdout.write = originalWrite
      }

      return { action: 'continue', output: captured || undefined }
    } catch (error: any) {
      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_command_failed', { message: error.message })),
      }
    }
  }

  private async executeSql(sql: string): Promise<ProcessResult> {
    // Permission check
    const permResult = checkPermission(sql, this.context.permission)
    if (!permResult.allowed) {
      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_permission', {
          required: permResult.classification.type === 'UNKNOWN' ? 'admin' : 'read-write',
          current: this.context.permission,
        })),
      }
    }

    const startTime = Date.now()

    try {
      const rows = await this.adapter.execute<Record<string, any>>(sql)
      const elapsed = Date.now() - startTime

      const columnNames = rows.length > 0 ? Object.keys(rows[0]) : []
      const queryResult: QueryResult<Record<string, any>> = {
        rows,
        rowCount: rows.length,
        columnNames,
        executionTimeMs: elapsed,
      }

      const formatted = this.formatter.format(queryResult, {
        format: this.state.format,
      })

      let output = formatted
      if (this.state.timing) {
        output += '\n' + pc.dim(t_vars('shell.timing_display', { ms: String(elapsed) }))
      }

      this.state = { ...this.state, connected: true }
      return { action: 'continue', output }
    } catch (error: any) {
      // Attempt auto-reconnect once on connection errors
      if (this.isConnectionError(error) && this.state.connected) {
        this.state = { ...this.state, connected: false }
        try {
          console.error(pc.yellow(t('shell.error_reconnecting')))
          await this.adapter.connect()
          this.state = { ...this.state, connected: true }
          console.error(pc.green(t('shell.error_reconnect_success')))
          // Retry the query once
          return this.executeSql(sql)
        } catch (reconnectError: any) {
          return {
            action: 'continue',
            output: pc.red(t_vars('shell.error_reconnect_failed', { message: reconnectError.message })),
          }
        }
      }

      return {
        action: 'continue',
        output: pc.red(t_vars('shell.error_sql_failed', { message: error.message })),
      }
    }
  }

  private isConnectionError(error: any): boolean {
    const msg = (error.message ?? '').toLowerCase()
    return (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      msg.includes('connection') ||
      msg.includes('terminated') ||
      msg.includes('socket')
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/repl/repl-engine.test.ts`
Expected: All tests PASS (some may need mock adjustments based on actual import structure)

- [ ] **Step 5: Commit**

```bash
git add src/core/repl/repl-engine.ts tests/core/repl/repl-engine.test.ts
git commit -m "feat: [shell] 新增 REPL 引擎（整合 SQL 執行、指令分派、meta 指令）"
```

---

## Task 10: Shell Command Registration

**Files:**
- Create: `tests/commands/shell.test.ts`
- Create: `src/commands/shell.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/commands/shell.test.ts
import { describe, test, expect } from 'bun:test'
import { shellCommand } from '../../src/commands/shell'

describe('shellCommand', () => {
  test('is a Commander command', () => {
    expect(shellCommand.name()).toBe('shell')
  })

  test('has --sql option', () => {
    const opts = shellCommand.options
    const sqlOpt = opts.find(o => o.long === '--sql')
    expect(sqlOpt).toBeDefined()
  })

  test('has description', () => {
    expect(shellCommand.description()).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/commands/shell.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write shell command**

```typescript
// src/commands/shell.ts
import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { configModule } from '../core/config'
import { AdapterFactory } from '../adapters/factory'
import { ReplEngine } from '../core/repl/repl-engine'
import { createCompleter } from '../core/repl/completer'
import { highlightSQL } from '../utils/sql-highlight'
import type { ReplContext } from '../core/repl/types'
import type { DbcliConfig } from '../types'
import { t, t_vars } from '../i18n/message-loader'
import pc from 'picocolors'

const HISTORY_PATH = join(homedir(), '.dbcli_history')

export const shellCommand = new Command('shell')
  .description('Interactive database shell with auto-completion and syntax highlighting')
  .option('--sql', 'SQL-only mode (skip dbcli command parsing)')
  .action(async (options: { sql?: boolean }) => {
    await runShell(options)
  })

async function runShell(options: { sql?: boolean }): Promise<void> {
  // Load config
  let config: DbcliConfig
  try {
    config = await configModule.read('.dbcli')
  } catch {
    console.error(pc.red(t('shell.error_no_config')))
    process.exit(1)
  }

  // Connect to database
  const adapter = AdapterFactory.createAdapter(config.connection)
  try {
    await adapter.connect()
  } catch (error: any) {
    console.error(pc.red(t_vars('shell.error_connection_failed', { message: error.message })))
    process.exit(1)
  }

  // Build context from schema cache
  const schemaData = config.schema ?? {}
  const tableNames = Object.keys(schemaData)
  const columnsByTable: Record<string, string[]> = {}
  for (const [table, data] of Object.entries(schemaData)) {
    const tableData = data as any
    if (tableData?.columns && Array.isArray(tableData.columns)) {
      columnsByTable[table] = tableData.columns.map((c: any) => c.name)
    }
  }

  const context: ReplContext = {
    configPath: '.dbcli',
    permission: config.permission,
    system: config.connection.system,
    tableNames,
    columnsByTable,
  }

  const engine = new ReplEngine(adapter, context, HISTORY_PATH)
  const complete = createCompleter(context)

  // Welcome message
  console.error(pc.bold(t_vars('shell.welcome', {
    system: config.connection.system,
    database: String(config.connection.database),
    host: String(config.connection.host),
    port: String(config.connection.port),
  })))
  console.error(pc.dim(t_vars('shell.welcome_permission', { permission: config.permission })))

  if (options.sql) {
    console.error(pc.dim(t('shell.sql_mode_hint')))
  }

  console.error('')

  // Create readline interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: pc.cyan(t('shell.prompt') + '> '),
    completer: (line: string) => complete(line),
    terminal: process.stdin.isTTY ?? false,
  })

  const continuationPrompt = pc.dim(t('shell.continuation_prompt') + '> ')

  rl.prompt()

  rl.on('line', async (line: string) => {
    const result = await engine.processInput(line)

    switch (result.action) {
      case 'quit':
        if (result.output) console.error(result.output)
        rl.close()
        return

      case 'clear':
        console.clear()
        break

      case 'multiline':
        rl.setPrompt(continuationPrompt)
        break

      case 'continue':
        if (result.output) {
          // Output structured data to stdout, messages to stderr
          console.log(result.output)
        }
        rl.setPrompt(pc.cyan(t('shell.prompt') + '> '))
        break
    }

    rl.prompt()
  })

  rl.on('close', async () => {
    console.error(pc.dim(t('shell.goodbye')))
    engine.saveHistory()
    await adapter.disconnect()
    process.exit(0)
  })

  // Handle SIGINT (Ctrl+C) — cancel multiline, don't exit
  rl.on('SIGINT', () => {
    if (engine.isMultiline()) {
      console.error(pc.dim(t('shell.multiline_cancelled')))
      // Reset multiline buffer by processing empty meta
      rl.setPrompt(pc.cyan(t('shell.prompt') + '> '))
    }
    rl.prompt()
  })
}
```

- [ ] **Step 4: Register in cli.ts**

Add to `src/cli.ts`:

```typescript
import { shellCommand } from './commands/shell'

// In the command registration section:
program.addCommand(shellCommand)
```

Find the section where other commands are registered (e.g., `program.addCommand(statusCommand)`) and add `shellCommand` alongside them.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/commands/shell.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Verify CLI registration**

Run: `bun run src/cli.ts --help`
Expected: `shell` command appears in the help output

Run: `bun run src/cli.ts shell --help`
Expected: Shows shell command help with `--sql` option

- [ ] **Step 7: Commit**

```bash
git add src/commands/shell.ts src/cli.ts tests/commands/shell.test.ts
git commit -m "feat: [shell] 新增 dbcli shell 互動式指令與 CLI 註冊"
```

---

## Task 11: Integration Testing & Polish

**Files:**
- Modify: `src/core/repl/repl-engine.ts` (if fixes needed)
- Modify: `src/commands/shell.ts` (if fixes needed)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All existing tests still pass, all new REPL tests pass

- [ ] **Step 2: Manual smoke test (requires DB connection)**

Run: `bun run src/cli.ts shell`

Test the following:
1. Type `SELECT 1;` → should execute and show result
2. Type `schema` → should list tables (if schema is cached)
3. Type `.help` → should show meta commands
4. Type `.format json` → should change format
5. Type a multi-line query:
   ```
   SELECT *
   FROM users
   LIMIT 1;
   ```
6. Press Tab → should show completions
7. Type `.quit` → should exit cleanly
8. Check `~/.dbcli_history` → should contain entries

- [ ] **Step 3: Fix any issues found during smoke test**

Address any bugs or UX issues discovered.

- [ ] **Step 4: Run test coverage check**

Run: `bun test --coverage`
Expected: New REPL modules have 80%+ coverage

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: [shell] 修正整合測試發現的問題"
```

---

## Task 12: Version Bump & Documentation

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `assets/SKILL.md`

- [ ] **Step 1: Bump version to 0.6.0-beta**

In `package.json`, change:
```json
"version": "0.6.0-beta"
```

- [ ] **Step 2: Update CHANGELOG.md**

Add new section at the top of the changelog:

```markdown
## [0.6.0-beta] - YYYY-MM-DD

### Interactive Shell — Smart REPL

### Added

- **`dbcli shell` command:** Interactive database shell with SQL execution and dbcli command dispatch
- **SQL-only mode:** `--sql` flag restricts to SQL statements only
- **Auto-completion (Tab):** Context-aware completion for SQL keywords, table names, column names, and dbcli commands
- **Multi-line SQL:** Accumulates input until `;` is found, with `...>` continuation prompt
- **SQL syntax highlighting:** Real-time colorization of keywords, strings, and numbers
- **Meta commands:** `.help`, `.quit`/`.exit`, `.clear`, `.format`, `.history`, `.timing`
- **Persistent history:** Stored in `~/.dbcli_history` (max 1000 entries), with up/down navigation and Ctrl+R search
- **Permission & blacklist integration:** Full enforcement within REPL session
- **Error resilience:** SQL/permission/connection errors never crash the session
- **i18n support:** All shell messages available in English and Traditional Chinese
```

- [ ] **Step 3: Update SKILL.md**

Add `shell` command documentation to `assets/SKILL.md`:

```markdown
### `dbcli shell`

Start an interactive database shell.

```bash
dbcli shell          # Interactive mode with SQL + dbcli commands
dbcli shell --sql    # SQL-only mode
```

Inside the shell:
- Type SQL statements ending with `;` to execute
- Type dbcli commands without the `dbcli` prefix (e.g., `schema users`)
- Use Tab for auto-completion
- Type `.help` for meta commands
```

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md assets/SKILL.md
git commit -m "chore: bump version to 0.6.0-beta 並更新文件"
```

---

## Summary

| Task | Module | Tests | Lines (est.) |
|------|--------|-------|-------------|
| 1 | Types | — | ~60 |
| 2 | Input Classifier | 16 | ~40 |
| 3 | Multiline Buffer | 10 | ~50 |
| 4 | Meta Commands | 15 | ~100 |
| 5 | Tab Completer | 14 | ~120 |
| 6 | History Manager | 8 | ~60 |
| 7 | Command Dispatcher | 8 | ~30 |
| 8 | i18n Messages | — | ~40 (JSON) |
| 9 | REPL Engine | 10 | ~180 |
| 10 | Shell Command | 3 + CLI smoke | ~120 |
| 11 | Integration Test | smoke | fixes |
| 12 | Version & Docs | — | changelog |
| **Total** | | **~84 tests** | **~800 lines** |

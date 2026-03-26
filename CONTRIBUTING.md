# Contributing to dbcli

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

### Development Environment Setup

```bash
# Clone the repository
git clone https://github.com/your-org/dbcli.git
cd dbcli

# Install dependencies using Bun
bun install

# Start development
bun run dev -- init
```

### Prerequisites

- Bun >= 1.3.3 (see [bun.sh](https://bun.sh))
- Node.js >= 18.0.0 (for TypeScript compatibility)
- PostgreSQL, MySQL, or MariaDB (optional, for testing)

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes

Follow these guidelines:
- Keep functions small (< 50 lines)
- Keep files focused (< 800 lines)
- Use immutable patterns (no object mutation)
- Add proper error handling
- No hardcoded values
- No `console.log` statements in production code

### 3. Write Tests

Before writing code, write tests:

```bash
# Unit tests
bun test

# Watch mode
bun test --watch

# Coverage
bun test --coverage
```

Target: **80%+ test coverage** for all new code.

### 4. Test Locally

```bash
# Build the CLI
bun build src/cli.ts --outfile dist/cli.mjs

# Test commands
DBCLI_LANG=en ./dist/cli.mjs --help
DBCLI_LANG=zh-TW ./dist/cli.mjs --help
```

### 5. Commit

Use conventional commit format:

```bash
git commit -m "feat(12-02): add new feature description"
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

### 6. Push & Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a PR on GitHub.

## i18n Guidelines

i18n is critical for dbcli. All user-facing messages must be translatable.

### When Adding New Messages

1. **Add English message** to `resources/lang/en/messages.json`:

```json
{
  "mycommand": {
    "welcome": "Welcome to mycommand",
    "success": "Operation completed: {result}"
  }
}
```

2. **Add Traditional Chinese translation** to `resources/lang/zh-TW/messages.json`:

```json
{
  "mycommand": {
    "welcome": "歡迎使用 mycommand",
    "success": "操作完成: {result}"
  }
}
```

3. **Use in command code** (always with `t()` or `t_vars()`):

```typescript
import { t, t_vars } from '@/i18n/message-loader'

console.log(t('mycommand.welcome'))
console.log(t_vars('mycommand.success', { result: 'success' }))
```

### Message Key Naming Convention

Use dot notation with namespace and action:

```
namespace.action
```

Examples:
- `init.welcome` — Init command welcome
- `query.executing` — Query command executing status
- `errors.connection_failed` — Connection error
- `success.inserted` — Success message for insert
- `delete.admin_only` — Permission error for delete

### Testing i18n

Every new message must be tested in both languages:

```typescript
import { test, expect, beforeEach, vi } from 'vitest'
import { t } from '@/i18n/message-loader'

beforeEach(() => {
  vi.resetModules()
})

test('message displays in English', () => {
  vi.stubEnv('DBCLI_LANG', 'en')
  expect(t('mycommand.welcome')).toContain('Welcome')
})

test('message displays in Chinese', () => {
  vi.stubEnv('DBCLI_LANG', 'zh-TW')
  expect(t('mycommand.welcome')).toContain('歡迎')
})
```

### Key Consistency

The message keys in `en/messages.json` and `zh-TW/messages.json` **must match exactly**:

```bash
# Check for missing keys
jq -S 'keys_unsorted' resources/lang/en/messages.json > /tmp/en_keys.txt
jq -S 'keys_unsorted' resources/lang/zh-TW/messages.json > /tmp/zh_keys.txt
diff /tmp/en_keys.txt /tmp/zh_keys.txt  # Should be empty
```

### No Hardcoded Messages

❌ **Wrong:**
```typescript
console.log('Error: operation failed')
console.log('操作失敗')
console.log('Operation completed with: ' + result)
```

✅ **Correct:**
```typescript
import { t, t_vars } from '@/i18n/message-loader'

console.error(t('errors.operation_failed'))
console.log(t_vars('success.completed', { result }))
```

## Code Style

### Immutability

Always create new objects, never mutate:

```typescript
// WRONG
function updateUser(user, name) {
  user.name = name
  return user
}

// CORRECT
function updateUser(user, name) {
  return {
    ...user,
    name
  }
}
```

### Error Handling

Always handle errors comprehensively:

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error(t_vars('errors.message', { message: error.message }))
  throw new Error('User-friendly message via i18n')
}
```

### Input Validation

Use Zod for validation:

```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

const validated = schema.parse(input)
```

## Testing

### Unit Tests

```typescript
import { test, expect } from 'vitest'

test('queryCommand returns results', async () => {
  const result = await queryCommand('SELECT 1', {})
  expect(result).toBeDefined()
})
```

### Integration Tests

Test full workflows with database connections:

```typescript
test('init and query workflow', async () => {
  // 1. Initialize
  await initCommand({ host: 'localhost', port: 5432, ... })

  // 2. Query
  const result = await queryCommand('SELECT 1', {})

  // 3. Assert
  expect(result.rows).toHaveLength(1)
})
```

### E2E Tests

Test user workflows end-to-end using Playwright (if applicable).

## Release Process

### Version Bumping

```bash
# Patch release (v1.0.0 -> v1.0.1)
npm version patch

# Minor release (v1.0.0 -> v1.1.0)
npm version minor

# Major release (v1.0.0 -> v2.0.0)
npm version major
```

### Publishing

```bash
# Build
bun build src/cli.ts --outfile dist/cli.mjs

# Publish to npm
npm publish
```

### Changelog

Update `CHANGELOG.md` with:
- **Added** — New features
- **Changed** — Behavior changes
- **Fixed** — Bug fixes
- **Removed** — Deprecated features

Format:

```markdown
## [1.1.0] - 2026-03-27

### Added
- i18n support with English and Traditional Chinese
- Multi-language CLI help text

### Fixed
- Query timeout issue on large result sets

### Changed
- Init command now prompts for language preference
```

## Code Review Checklist

Before submitting a PR, ensure:

- [ ] Tests pass: `bun test`
- [ ] Build succeeds: `bun build src/cli.ts`
- [ ] Code style compliant: No `console.log`, immutable patterns, error handling
- [ ] i18n messages extracted (if applicable)
- [ ] Both English and Chinese translations added
- [ ] No hardcoded user-facing strings
- [ ] Commit messages follow conventional format
- [ ] No security vulnerabilities (no hardcoded secrets, SQL injection, XSS)

## Questions?

- Check existing [Issues](https://github.com/your-org/dbcli/issues)
- Read [Project Documentation](./README.md)
- See [i18n README](./src/i18n/README.md)

---

**Thank you for contributing!**

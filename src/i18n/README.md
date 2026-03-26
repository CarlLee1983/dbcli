# MessageLoader — i18n System

MessageLoader is a singleton class that provides internationalization (i18n) support for dbcli, enabling messages to be displayed in multiple languages.

## Overview

The MessageLoader system:
- Loads language-specific JSON message files at CLI startup
- Supports English (primary) and Traditional Chinese (fallback)
- Provides automatic fallback to English if a key is missing
- Supports variable interpolation in messages
- Initializes synchronously with minimal overhead (< 2ms)

## Basic Usage

```typescript
import { t, t_vars } from '@/i18n/message-loader'

// Simple message
const welcome = t('init.welcome')
console.log(welcome) // "Welcome to dbcli" or "歡迎使用 dbcli"

// Message with interpolation
const result = t_vars('success.inserted', { count: 5 })
console.log(result) // "Successfully inserted 5 row(s)"
```

## Environment Variable

Control the language via the `DBCLI_LANG` environment variable:

```bash
# English (default)
DBCLI_LANG=en bun run src/cli.ts

# Traditional Chinese
DBCLI_LANG=zh-TW bun run src/cli.ts
```

If `DBCLI_LANG` is not set, English is used by default.

## Key Structure

Message keys use dot notation to organize by namespace:

```
namespace.key
```

Examples:
- `init.welcome` — Initialization welcome message
- `errors.connection_failed` — Connection error message
- `success.inserted` — Success message for INSERT

### Available Namespaces

- **init** — Initialization and configuration
- **schema** — Schema discovery and refresh
- **list** — Listing tables
- **query** — Query execution
- **errors** — Error messages (support interpolation)
- **success** — Success messages (support interpolation)
- **insert** — INSERT command
- **update** — UPDATE command
- **delete** — DELETE command
- **export** — Export functionality
- **skill** — AI skill generation

## Fallback Behavior

If a key is missing:
1. First try the selected language (e.g., zh-TW)
2. Fall back to English
3. Last resort: return the key name itself

Example:
```typescript
const msg = t('nonexistent.key')
console.log(msg) // "nonexistent.key"
```

## Variable Interpolation

Use `t_vars()` to replace variables in messages:

```typescript
const msg = t_vars('success.inserted', { count: 10 })
// Result: "Successfully inserted 10 row(s)"

const msg2 = t_vars('errors.invalid_config', { field: 'database_host' })
// Result: "Invalid configuration: database_host"
```

Supports multiple variables:
```typescript
const msg = t_vars('insert.confirm', { count: 5, table: 'users' })
// Result: "Insert 5 row(s) into users? (y/n): "
```

## Adding New Messages

To add a new message:

1. Add the key and English text to `resources/lang/en/messages.json`
2. Add the same key and Traditional Chinese translation to `resources/lang/zh-TW/messages.json`
3. Use it in your command via `t("key")` or `t_vars("key", { vars })`

**Important:** Keys must match exactly between English and Chinese files.

Example:
```json
// resources/lang/en/messages.json
{
  "myfeature": {
    "title": "My Feature",
    "description": "Feature description with {placeholder}"
  }
}

// resources/lang/zh-TW/messages.json
{
  "myfeature": {
    "title": "我的功能",
    "description": "功能說明包含 {placeholder}"
  }
}
```

Then use:
```typescript
import { t, t_vars } from '@/i18n/message-loader'

const title = t('myfeature.title')
const desc = t_vars('myfeature.description', { placeholder: 'example' })
```

## Testing

Tests are located in `src/i18n/message-loader.test.ts`:

```bash
bun test src/i18n/message-loader.test.ts --run
```

Tests cover:
- Default language selection
- Custom language selection via `DBCLI_LANG`
- Fallback behavior
- Variable interpolation
- Singleton pattern
- Edge cases (special characters, missing keys)

## Phase 02 Integration

Phase 02 will refactor all existing commands to use the MessageLoader system, replacing hardcoded Chinese strings with calls to `t()` and `t_vars()`. The infrastructure is complete and ready for downstream integration.

# Redis Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full Redis support in `dbcli`, including key-value operations, discovery, metadata inspection, and security guards.

**Architecture:** A new `RedisAdapter` implementing the `QueryableAdapter` interface, using `ioredis` as the driver. It supports string-based command input and provides structural metadata for keys.

**Tech Stack:** TypeScript, `ioredis`, Vitest, Docker (for testing).

---

### Task 1: Dependencies & Environment

**Files:**
- Modify: `package.json`
- Modify: `docker-compose.test.yml`

- [ ] **Step 1: Add ioredis dependency**

Run: `bun add ioredis`

- [ ] **Step 2: Add Redis to test environment**

Add a `redis` service to `docker-compose.test.yml`.

```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock docker-compose.test.yml
git commit -m "chore: add ioredis dependency and redis test container"
```

---

### Task 2: RedisAdapter - Core & Connection

**Files:**
- Create: `src/adapters/redis-adapter.ts`
- Modify: `src/adapters/types.ts` (add 'redis' to `system` type)

- [ ] **Step 1: Update ConnectionOptions type**

Add `'redis'` to the `system` union in `ConnectionOptions`.

- [ ] **Step 2: Implement RedisAdapter skeleton**

Implement `connect`, `disconnect`, `testConnection`, and `getServerVersion`.

```typescript
import Redis from 'ioredis'
import { ConnectionError } from './types'
// ...
export class RedisAdapter implements QueryableAdapter {
  private client: Redis | null = null
  // ...
  async connect() {
    this.client = new Redis({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      db: Number(this.options.database || 0),
      connectTimeout: this.options.timeout || 5000
    })
    // ...
  }
}
```

- [ ] **Step 3: Write connection test**

Create `tests/unit/adapters/redis-adapter.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/redis-adapter.ts src/adapters/types.ts tests/unit/adapters/redis-adapter.test.ts
git commit -m "feat: implement RedisAdapter connection logic"
```

---

### Task 3: RedisAdapter - Discovery & Schema

**Files:**
- Modify: `src/adapters/redis-adapter.ts`

- [ ] **Step 1: Implement listCollections**

Use `SCAN 0 COUNT 1000` to list keys.

- [ ] **Step 2: Implement getTableSchema**

Use `TYPE`, `TTL`, and size commands (`STRLEN`, `HLEN`, etc.) to build metadata.

- [ ] **Step 3: Update tests**

Add tests for listing and schema inspection in `tests/unit/adapters/redis-adapter.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/redis-adapter.ts tests/unit/adapters/redis-adapter.test.ts
git commit -m "feat: implement Redis key discovery and schema inspection"
```

---

### Task 4: RedisAdapter - Command Execution

**Files:**
- Modify: `src/adapters/redis-adapter.ts`

- [ ] **Step 1: Implement command parser**

Implement a simple `parseCommand(cmd: string): string[]` that handles quoted arguments.

- [ ] **Step 2: Implement execute**

Map the parsed command to `this.client.call(command, ...args)`.

- [ ] **Step 3: Implement insert/update/delete**

Map to `SET`, `HSET`, `DEL`, etc.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/redis-adapter.ts
git commit -m "feat: implement Redis command execution and DML mapping"
```

---

### Task 5: Security Integration

**Files:**
- Modify: `src/core/permission-guard.ts`
- Modify: `src/adapters/error-mapper.ts`
- Modify: `src/adapters/factory.ts`

- [ ] **Step 1: Add Redis permissions**

Add Redis command classifications to `classifyStatement` or create a `classifyRedisCommand`.

- [ ] **Step 2: Update Error Mapper**

Handle Redis connection errors in `mapError`.

- [ ] **Step 3: Update AdapterFactory**

Register `RedisAdapter` in `createAdapter`.

- [ ] **Step 4: Commit**

```bash
git add src/core/permission-guard.ts src/adapters/error-mapper.ts src/adapters/factory.ts
git commit -m "feat: integrate Redis with permission guard and factory"
```

---

### Task 6: CLI Command Integration

**Files:**
- Modify: `src/commands/query.ts`
- Modify: `src/commands/list.ts`
- Modify: `src/commands/schema.ts`

- [ ] **Step 1: Implement redisQueryBranch**

Update `queryCommand` to handle Redis connections and format results.

- [ ] **Step 2: Implement redisListBranch**

Update `listAction` to handle Redis key listing.

- [ ] **Step 3: Update schema action**

Ensure `schemaAction` works for Redis keys.

- [ ] **Step 4: Commit**

```bash
git add src/commands/query.ts src/commands/list.ts src/commands/schema.ts
git commit -m "feat: integrate Redis support into CLI commands"
```

---

### Task 7: Integration Testing

**Files:**
- Create: `tests/integration/adapters/redis.test.ts`

- [ ] **Step 1: Write integration tests**

Verify end-to-end flow: connect -> list -> query -> schema.

- [ ] **Step 2: Run all tests**

Run: `bun test tests/integration/adapters/redis.test.ts`

- [ ] **Step 3: Commit**

```bash
git add tests/integration/adapters/redis.test.ts
git commit -m "test: add Redis integration tests"
```

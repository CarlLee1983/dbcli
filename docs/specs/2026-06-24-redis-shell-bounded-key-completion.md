# Redis Shell Bounded Key Completion Design Specification

**Date:** 2026-06-24
**Status:** Designed — pending implementation
**Baseline:** dbcli v1.38.1 Redis shell (`src/commands/shell.ts`,
`src/adapters/redis-adapter.ts`)

> **Origin:** Deferred follow-up from
> `docs/specs/2026-06-22-command-completion-source-of-truth.md:406-412` (§17):
> "Redis shell key completion can still block startup on large keyspaces because
> `runShell()` populates Redis key names before showing the prompt. That is a
> separate performance milestone." This is that milestone.

## 1. Purpose

Make the Redis interactive shell (`dbcli shell` on a Redis connection) show its
prompt without first scanning the entire keyspace. Today startup blocks on a
full `SCAN` (up to 100,000 keys) purely to populate tab-completion key names.

## 2. Problem

`runShell()` (`src/commands/shell.ts:111-114`) does, for Redis connections:

```ts
const keys = await adapter.listTables()   // RedisShellAdapter.listTables -> inner.listCollections
tableNames = keys.map((k) => k.name)
```

`listCollections()` (`src/adapters/redis-adapter.ts:131-138`) calls
`scanAllKeys(client, '*', 1000)`. The `1000` is the SCAN `COUNT` *hint*, not a
cap: `scanAllKeys` (`redis-adapter.ts:468-485`) loops `do { SCAN } while (cursor
!== '0')`, breaking only at `seen.size >= 100_000`. On a large keyspace this is
dozens of synchronous round-trips loading up to 100k key names into memory
**before the prompt appears**.

The welcome line "SCAN/LRANGE auto-capped at 1000" refers to a per-command
*result* cap (`src/adapters/redis/size-guard.ts`), unrelated to this startup
scan.

## 3. Precedent

The MongoDB shell path already degrades gracefully: `populateMongoColumns`
(`src/commands/shell.ts:39-57`) skips eager per-collection schema sampling above
`MONGO_COMPLETION_EAGER_THRESHOLD = 20`, and prints a dim stderr notice when it
does. For Redis the expensive step is the key *names* themselves (full `SCAN`),
not column sampling, so the bound applies one level up — to how many keys we
sample for completion.

## 4. Decision

Bound the startup key discovery to a fixed key-count budget. Partial completion
on large keyspaces is acceptable (mirrors the Mongo "names only above threshold"
degradation). Rejected alternatives: background async load, time-box budget,
DBSIZE gate (see §9).

## 5. Design

### 5.1 Generalize `scanAllKeys` with a key cap

`src/adapters/redis-adapter.ts:468`

```ts
async function scanAllKeys(
  client: RedisClient,
  pattern: string,
  count: number,
  maxKeys: number = 100_000
): Promise<string[]> {
  const seen = new Set<string>()
  let cursor = '0'
  do {
    const reply = (await client.send('SCAN', [
      cursor, 'MATCH', pattern, 'COUNT', String(count),
    ])) as [string, string[]]
    const [next, batch] = reply
    for (const k of batch) seen.add(k)
    cursor = next
    if (seen.size >= maxKeys) break
  } while (cursor !== '0')
  return Array.from(seen)
}
```

The default `100_000` preserves the exact current behavior for every existing
caller — `listCollections()`'s full-keyspace enumeration is unchanged.

### 5.2 New bounded completion sampler

`src/adapters/redis-adapter.ts` — new public method on `RedisAdapter`:

```ts
/** Sample up to `limit` key names for shell completion, applying the same
 *  blacklist filtering as listCollections. `truncated` is true when the
 *  keyspace was larger than the sample budget. */
async sampleKeyNames(limit: number): Promise<{ names: string[]; truncated: boolean }> {
  const client = this.requireClient()
  const keys = await scanAllKeys(client, '*', limit, limit)
  const truncated = keys.length >= limit
  const rules = this.blacklistRules
  const visible =
    rules.length === 0
      ? keys
      : keys.filter((k) => !rules.map((p) => globToRegex(p)).some((r) => r.test(k)))
  return { names: visible, truncated }
}
```

Blacklist filtering is preserved so masked keys are never suggested. `truncated`
is derived from whether the sample hit its budget (filtering may reduce `names`
below `limit`, but truncation is about the scan, so it keys off the pre-filter
count).

### 5.3 Completion-limit constant

`src/commands/shell.ts` — alongside `MONGO_COMPLETION_EAGER_THRESHOLD`:

```ts
/** Redis shell samples at most this many keys for tab completion to keep startup fast. */
export const REDIS_COMPLETION_KEY_LIMIT = 1000
```

### 5.4 Shell startup wiring

`src/commands/shell.ts:111-114` Redis branch becomes:

```ts
if (isRedis) {
  try {
    const { names, truncated } = await redisInner!.sampleKeyNames(REDIS_COMPLETION_KEY_LIMIT)
    tableNames = names
    if (truncated) {
      console.error(
        pc.dim(
          `Redis shell: large keyspace; tab completion limited to the first ${REDIS_COMPLETION_KEY_LIMIT} keys.`
        )
      )
    }
  } catch {
    tableNames = [] // completion is best-effort; never block the prompt
  }
  columnsByTable = {}
}
```

`redisInner` is the concrete `RedisAdapter` (already constructed at
`shell.ts:86-93`), which exposes `sampleKeyNames`; the `RedisShellAdapter`
wrapper is unchanged.

## 6. Data Flow

connect → `sampleKeyNames(1000)` → `tableNames` (≤1000) → `ReplContext` → prompt.
No `DBSIZE` call; the key-count cap alone bounds startup work.

## 7. Error Handling

Completion is best-effort. A throw from `sampleKeyNames` is caught at the call
site, yields empty completion, and the prompt still appears. This also fixes the
current latent bug where a `listTables()` throw during startup is unhandled and
would crash the shell.

## 8. Testing (TDD)

- **Unit — `scanAllKeys` cap:** with a fake client returning batches, assert it
  stops once `seen.size >= maxKeys` and issues no further `SCAN` round-trips;
  assert the default-arg call still drains to `cursor === '0'`.
- **Unit — `sampleKeyNames`:** keyspace larger than `limit` → `truncated === true`
  and `names.length` bounded; blacklist rules filter masked keys out of `names`;
  empty/below-limit keyspace → `truncated === false`.
- **Integration — shell startup:** Redis connection with a large fake keyspace
  reaches prompt-ready without scanning beyond the cap and prints the dim
  notice; a `sampleKeyNames` that throws still yields a started shell with empty
  key completion.

## 9. Non-Goals / Rejected Alternatives

- **Background async populate** — best UX but requires async completion state and
  readline coordination; rejected for complexity (YAGNI).
- **Time-box budget** — depends on a clock, non-deterministic, flaky to test.
- **DBSIZE threshold gate** — extra round-trip; the count cap already bounds work.
- No change to `listCollections` full-scan semantics or any non-shell caller.
- No change to the per-command size guard or its "auto-capped at 1000" message.

## 10. Acceptance

- Redis shell on a >1000-key keyspace shows its prompt after sampling ≤1000 keys,
  not after a full scan; the dim truncation notice is printed.
- Existing `listCollections` callers behave identically (default `maxKeys`
  preserved).
- `bun test` (new unit + integration), `bun run typecheck`, `bun run lint` pass.
- No `docs/user/` change required: user-facing shell behavior (prompt, commands,
  completion mechanics) is unchanged except faster startup + an informational
  notice; revisit only if the notice or a flag becomes a documented surface.

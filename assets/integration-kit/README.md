# Skill Author Integration Kit

Copy `skill-author-consumer.ts` into a Bun/TypeScript Skill that depends on
`@carllee1983/dbcli`. It uses only the public `@carllee1983/dbcli/core` contract.

```ts
import { spawn } from 'bun'
import { discover, preflight } from './skill-author-consumer'

const run = async (args: readonly string[]) => {
  const child = spawn(['dbcli', ...args], { stdout: 'pipe', stderr: 'pipe' })
  return {
    code: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  }
}

const catalog = await discover(run) // strict catalog parsing and schema pinning
const gate = await preflight(run, ['schema.read', 'query.read'], 'STORY-123')
if (!gate.ok) throw new Error(gate.error?.code ?? 'requirements are unavailable')
console.log(catalog.capabilities.map(({ id }) => id))
```

`discover` accepts only exit `0`. `preflight` accepts `0`, `1`, or `2`: each is
a valid Operation Envelope response. Treat exit `1` as a completed negative
result and inspect `ok`, `data`, and `error`; exit `2` means invalid invocation.
Both helpers reject non-JSON output, stderr, unknown fields, and any schema
version other than the exported constants.

Use [`task-pack.md`](./task-pack.md) as the smallest `safety.requires` example.
It remains plan-only; do not put a CRUD, CQRS, or DBA workflow into dbcli.

[`external-consumers.ts`](./external-consumers.ts) supplies the requirements for
the three contract-test consumers: CRUD, CQRS, and DBA. They use this kit's
public contract only; dbcli neither implements nor approves their workflows.

The optional correlation ID is returned in `context.correlationId` for
non-static agent output and is recorded as audit metadata. It is not evidence:
for a supported command, request an evidence receipt with
`--evidence-receipt <workspace-relative-path>` and retain the returned receipt
with that correlation ID. Never put secrets, SQL, personal data, or free-form
input in a correlation ID.

import { describe, test, expect } from 'bun:test'
import { join } from 'node:path'
import { countAgentTasks } from '@/core/agent-tasks'

const FIX = join(import.meta.dir, '../../../fixtures/agent-tasks')

describe('countAgentTasks', () => {
  test('counts unique .md task names across dirs, excluding readme', async () => {
    // builtin fixture has sample.md + diag/inspect.md → 2 names ;
    // shared/local each have sample.md (dup name) → unique = { sample, diag/inspect } = 2
    const n = await countAgentTasks({
      builtinDir: join(FIX, 'builtin'),
      sharedDir: join(FIX, 'shared'),
      localDir: join(FIX, 'local'),
    })
    expect(n).toBe(2)
  })

  test('missing dirs contribute zero, never throws', async () => {
    const n = await countAgentTasks({
      builtinDir: join(FIX, 'does-not-exist'),
      sharedDir: join(FIX, 'nope'),
      localDir: join(FIX, 'nada'),
    })
    expect(n).toBe(0)
  })
})

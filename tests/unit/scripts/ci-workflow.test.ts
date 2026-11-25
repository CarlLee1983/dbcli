import { expect, test } from 'bun:test'

interface Step {
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
  'continue-on-error'?: boolean
}

interface Job {
  if?: string
  'timeout-minutes'?: number
  strategy?: {
    'fail-fast'?: boolean
    matrix?: {
      os?: string[]
      'bun-version'?: string[]
      include?: string | Record<string, string>[]
    }
  }
  steps?: Step[]
}

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/../../../.github/workflows/ci.yml`).text()
) as {
  on: { push: { branches: string[]; tags?: string[] }; pull_request: unknown }
  concurrency?: { group?: string; 'cancel-in-progress'?: string | boolean }
  permissions?: Record<string, string>
  jobs: Record<string, Job>
}

test('CI runs on PRs and main, avoiding feature-push and tag duplication', () => {
  expect(workflow.on).toEqual({
    push: { branches: ['main'] },
    pull_request: null,
  })
})

test('CI cancels superseded PR runs while keeping main pushes intact', () => {
  expect(workflow.concurrency?.group).toContain('github.event.pull_request.number')
  expect(workflow.concurrency?.['cancel-in-progress']).toBe(
    "${{ github.event_name == 'pull_request' }}"
  )
  expect(workflow.permissions).toEqual({ contents: 'read' })
})

test('job set, timeouts, and SHA-pinned actions match policy', () => {
  const expectedJobs = [
    'audit',
    'build-determinism',
    'docs-parity',
    'integration',
    'static-checks',
    'test',
  ]
  expect(Object.keys(workflow.jobs).sort()).toEqual(expectedJobs)

  for (const [name, job] of Object.entries(workflow.jobs)) {
    const timeout = job['timeout-minutes']
    expect(typeof timeout, `${name} timeout-minutes`).toBe('number')
    expect(Number.isInteger(timeout) && (timeout ?? 0) > 0, `${name} positive timeout`).toBe(true)

    for (const step of job.steps ?? []) {
      if (step.uses) {
        expect(step.uses, `${name} pinned action`).toMatch(/@[0-9a-f]{40}$/)
      }
    }
  }
})

test('the test matrix runs 6 OS/Bun entries on main and 4 on PRs without duplicating static checks', () => {
  expect(workflow.jobs.test?.if).toBeUndefined()
  expect(workflow.jobs.test?.strategy?.['fail-fast']).toBe(false)

  const includeExpr = workflow.jobs.test?.strategy?.matrix?.include
  expect(typeof includeExpr).toBe('string')
  const arrays = [...String(includeExpr).matchAll(/'(\[[^\]]+\])'/g)].map(
    (match) => JSON.parse(match[1] ?? '[]') as { os: string; 'bun-version': string }[]
  )
  expect(arrays).toHaveLength(2)
  expect(arrays[0]).toEqual([
    { os: 'ubuntu-latest', 'bun-version': '1.4.0' },
    { os: 'ubuntu-latest', 'bun-version': 'latest' },
    { os: 'macos-latest', 'bun-version': '1.4.0' },
    { os: 'macos-latest', 'bun-version': 'latest' },
    { os: 'windows-latest', 'bun-version': '1.4.0' },
    { os: 'windows-latest', 'bun-version': 'latest' },
  ])
  expect(arrays[1]).toEqual([
    { os: 'ubuntu-latest', 'bun-version': '1.4.0' },
    { os: 'ubuntu-latest', 'bun-version': 'latest' },
    { os: 'macos-latest', 'bun-version': 'latest' },
    { os: 'windows-latest', 'bun-version': 'latest' },
  ])

  const testRuns = (workflow.jobs.test?.steps ?? []).map((step) => step.run ?? '')
  expect(testRuns).not.toContain('bun run lint')
  expect(testRuns).not.toContain('bun run typecheck')
})

test('static-checks runs platform-independent guards once and integration runs canonical verification', () => {
  const staticRuns = (workflow.jobs['static-checks']?.steps ?? []).map((step) => step.run ?? '')
  for (const cmd of [
    'bun run format:check',
    'bun run agent-core:check',
    'bun run core-stdout:check',
    'bun run typecheck',
    'bun run typecheck:tests',
    'bun run lint',
  ]) {
    expect(staticRuns).toContain(cmd)
  }

  const integration = workflow.jobs.integration?.steps?.find(
    (step) => step.run === 'bun run ci:check'
  )
  expect(integration).toBeDefined()
  expect(integration?.['continue-on-error']).toBeUndefined()

  const upload = workflow.jobs.integration?.steps?.find(
    (step) => step.with?.name === 'verification-attestation'
  )
  expect(upload?.if).toBe('always()')
  expect(upload?.with?.path).toBe('.verification/attestation.json')
  expect(typeof upload?.with?.['retention-days']).toBe('number')
})

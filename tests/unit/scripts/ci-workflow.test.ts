import { expect, test } from 'bun:test'

interface Job {
  if?: string
  strategy?: { 'fail-fast'?: boolean; matrix?: { os: string[]; 'bun-version': string[] } }
  steps?: { run?: string; 'continue-on-error'?: boolean }[]
}

const workflow = Bun.YAML.parse(
  await Bun.file(`${import.meta.dir}/../../../.github/workflows/ci.yml`).text()
) as {
  on: { push: { branches: string[]; tags: string[] }; pull_request: unknown }
  jobs: Record<string, Job>
}

test('CI runs on PRs, main and release tags, avoiding feature push plus PR duplication', () => {
  expect(workflow.on).toEqual({
    push: { branches: ['main'], tags: ['v*.*.*'] },
    pull_request: null,
  })
})

test('the full OS/Bun matrix runs for every admitted event, including tags', () => {
  expect(workflow.jobs.test?.if).toBeUndefined()
  expect(workflow.jobs.test?.strategy).toEqual({
    'fail-fast': false,
    matrix: {
      os: ['ubuntu-latest', 'macos-latest', 'windows-latest'],
      'bun-version': ['1.4.0', 'latest'],
    },
  })
})

test('only canonical-covered jobs are skipped on tags; PR/main retain them', () => {
  const covered = ['audit', 'build-determinism', 'docs-parity', 'format', 'integration']
  expect(Object.keys(workflow.jobs).sort()).toEqual([...covered, 'test'].sort())
  for (const name of covered) {
    expect(workflow.jobs[name]?.if).toBe("${{ !startsWith(github.ref, 'refs/tags/') }}")
  }
  const integration = workflow.jobs.integration?.steps?.find((step) => step.run === 'make verify')
  expect(integration).toBeDefined()
  expect(integration?.['continue-on-error']).toBeUndefined()
})

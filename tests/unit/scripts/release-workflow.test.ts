/**
 * `.github/workflows/release.yml` is the only path that publishes to npm, and
 * what keeps that safe is structure nobody reads on every run: the trigger, the
 * permissions, the approval environment, the job order, and the absence of any
 * stored token. This pins those, so loosening one shows up as a failing test
 * rather than as a review comment that may not come.
 */

import { describe, test, expect } from 'bun:test'

const path = `${import.meta.dir}/../../../.github/workflows/release.yml`
const raw = await Bun.file(path).text()

interface Step {
  uses?: string
  run?: string
  with?: Record<string, unknown>
  if?: string
  'continue-on-error'?: boolean
}

interface Job {
  steps?: Step[]
  needs?: string | string[]
  environment?: string | { name: string }
  permissions?: Record<string, string>
  if?: string
  'continue-on-error'?: boolean
}

const workflow = Bun.YAML.parse(raw) as {
  // YAML 1.1 parsers may read the bare key `on` as boolean true.
  on?: { push?: { tags?: string[]; branches?: string[] } } & Record<string, unknown>
  permissions?: Record<string, string>
  jobs: Record<string, Job>
}

const needs = (job: string): string[] => {
  const value = workflow.jobs[job]?.needs
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

describe('release.yml', () => {
  test('is triggered only by pushing v*.*.* tags', () => {
    const trigger = workflow.on ?? ((workflow as Record<string, unknown>)['true'] as never)
    expect(Object.keys(trigger)).toEqual(['push'])
    expect(trigger.push?.tags).toEqual(['v*.*.*'])
    expect(trigger.push?.branches).toBeUndefined()
  })

  test('grants contents: read at workflow level and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  test('publish uses the npm-publish environment and id-token: write', () => {
    const publish = workflow.jobs.publish
    const environment =
      typeof publish?.environment === 'string' ? publish.environment : publish?.environment?.name
    expect(environment).toBe('npm-publish')
    expect(publish?.permissions?.['id-token']).toBe('write')
  })

  test('only publish gets id-token, only github-release gets contents: write', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== 'publish') expect(job.permissions?.['id-token']).toBeUndefined()
      if (name !== 'github-release') expect(job.permissions?.contents).not.toBe('write')
    }
    expect(workflow.jobs['github-release']?.permissions?.contents).toBe('write')
  })

  test('references no npm token anywhere', () => {
    expect(raw).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/)
  })

  test('jobs run in order: check-tag, verify, publish, github-release', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(
      ['check-tag', 'github-release', 'publish', 'verify'].sort()
    )
    expect(needs('check-tag')).toEqual([])
    expect(needs('verify')).toEqual(['check-tag'])
    expect(needs('publish')).toEqual(['verify'])
    expect(needs('github-release')).toEqual(['publish'])
  })

  test('check-tag requires a plain vX.Y.Z tag and an ancestor of main', () => {
    const runs = (workflow.jobs['check-tag']?.steps ?? []).map((step) => step.run ?? '').join('\n')
    expect(runs).toContain('^v[0-9]+\\.[0-9]+\\.[0-9]+$')
    expect(runs).toContain('merge-base --is-ancestor')
  })

  test('publishing requires successful canonical verification of the checked-out tag', () => {
    const verify = workflow.jobs.verify
    if (!verify) throw new Error('Release is missing canonical verification')
    expect(verify.if).toBeUndefined()
    expect(verify['continue-on-error']).toBeUndefined()
    const checkout = verify.steps?.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout).toBeDefined()
    expect(checkout?.with?.ref).toBeUndefined()
    const canonical = verify.steps?.filter((step) => step.run === 'make verify') ?? []
    expect(canonical).toHaveLength(1)
    expect(canonical[0]?.if).toBeUndefined()
    expect(canonical[0]?.['continue-on-error']).toBeUndefined()
    expect(needs('publish')).toEqual(['verify'])
    expect(workflow.jobs.publish?.if).toBeUndefined()
  })

  test('publish asserts npm >= 11.5.1, installs frozen, and leaves registry-url unset', () => {
    const steps = workflow.jobs.publish?.steps ?? []
    const runs = steps.map((step) => step.run ?? '').join('\n')
    expect(runs).toContain('11.5.1')
    expect(runs).toContain('bun install --frozen-lockfile')
    const setupNode = steps.find((step) => step.uses?.startsWith('actions/setup-node@'))
    expect(setupNode).toBeDefined()
    expect(setupNode?.with?.['registry-url']).toBeUndefined()
  })
})

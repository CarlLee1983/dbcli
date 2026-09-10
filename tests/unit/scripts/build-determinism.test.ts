/**
 * The determinism check's two decisions, taken away from its two builds.
 *
 * The check itself spends two minutes building; these are the parts that decide
 * what to say afterwards, and they are pure so that they can be asserted without
 * spending it. DBCLI-032 removed the roster's separate `bun run build` step,
 * which is what used to make a broken build readable — so the message a failing
 * build produces is now this check's own responsibility and has a test.
 */
import { describe, expect, test } from 'bun:test'
import { buildFailureMessage, driftedArtifacts } from '../../../scripts/lib/build-determinism'

describe('driftedArtifacts', () => {
  const artifacts = ['dist/cli.mjs', 'dist/core.mjs'] as const

  test('identical digests drift nowhere', () => {
    const digests = new Map([
      ['dist/cli.mjs', 'aaa'],
      ['dist/core.mjs', 'bbb'],
    ])

    expect(driftedArtifacts(artifacts, digests, new Map(digests))).toEqual([])
  })

  test('an artifact whose second build differs is named', () => {
    const first = new Map([
      ['dist/cli.mjs', 'aaa'],
      ['dist/core.mjs', 'bbb'],
    ])
    const second = new Map([
      ['dist/cli.mjs', 'aaa'],
      ['dist/core.mjs', 'ccc'],
    ])

    expect(driftedArtifacts(artifacts, first, second)).toEqual(['dist/core.mjs'])
  })

  test('a digest that is missing counts as drift, not as agreement', () => {
    // `undefined === undefined` is the shape that turns a build which produced
    // nothing into a passing reproducibility check.
    const first = new Map([['dist/cli.mjs', 'aaa']])

    expect(driftedArtifacts(artifacts, first, first)).toEqual(['dist/core.mjs'])
  })
})

describe('buildFailureMessage', () => {
  test('names which build failed and carries the build output', () => {
    const message = buildFailureMessage('second', 1, 'error: Could not resolve "./missing"')

    expect(message).toContain('second')
    expect(message).toContain('exit 1')
    expect(message).toContain('Could not resolve')
  })

  test('a build that failed silently says so rather than printing nothing', () => {
    // A failure whose message is empty reads as a tool that did not run. The
    // separate `bun run build` step used to make this legible; it is gone.
    const message = buildFailureMessage('first', 137, '   \n')

    expect(message).toContain('first')
    expect(message).toContain('exit 137')
    expect(message).toMatch(/no output/i)
  })
})

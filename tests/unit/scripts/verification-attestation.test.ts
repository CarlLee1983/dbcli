/**
 * A Verification Attestation states what one `make verify` run decided.
 *
 * Everything here runs on fixtures. The writer's own value — that a FAIL leaves
 * a record bound to the revision it failed at — is not something a unit test can
 * prove; what it can pin is that the document says only what the repository can
 * verify for itself, and that it says it the same way twice.
 */

import { describe, expect, test } from 'bun:test'
import {
  ATTESTATION_SCHEMA_VERSION,
  buildAttestation,
  parseAttestation,
  readEnvironment,
  serialiseAttestation,
  type AttestationInput,
} from '../../../scripts/lib/verification-attestation'

const REVISION = '980cc078b850f799615dce51b2993141b85c40c7'

const INPUT: AttestationInput = {
  repository: 'CarlLee1983/dbcli',
  revision: REVISION,
  dirtyWorktree: false,
  command: 'make verify',
  exitCode: 0,
  startedAt: '2026-09-08T04:00:00.000Z',
  finishedAt: '2026-09-08T04:15:30.500Z',
  environment: { os: 'darwin', arch: 'arm64', bun: '1.3.10', ci: false },
}

describe('buildAttestation', () => {
  test('states the revision, the command and what happened', () => {
    const attestation = buildAttestation(INPUT)

    expect(attestation.schema_version).toBe(ATTESTATION_SCHEMA_VERSION)
    expect(attestation.revision).toBe(REVISION)
    expect(attestation.command).toBe('make verify')
    expect(attestation.result).toBe('PASS')
    expect(attestation.exit_code).toBe(0)
    expect(attestation.duration_ms).toBe(930500)
  })

  test('a non-zero exit is a FAIL, and the code is kept', () => {
    const attestation = buildAttestation({ ...INPUT, exitCode: 2 })

    expect(attestation.result).toBe('FAIL')
    expect(attestation.exit_code).toBe(2)
  })

  test('a dirty worktree is stated, not silently attributed to the commit', () => {
    const attestation = buildAttestation({ ...INPUT, dirtyWorktree: true })

    expect(attestation.dirty_worktree).toBe(true)
    expect(attestation.revision).toBe(REVISION)
  })

  test('the hash is the identity of the content', () => {
    const hash = buildAttestation(INPUT).attestation_hash

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(buildAttestation(INPUT).attestation_hash).toBe(hash)
    expect(buildAttestation({ ...INPUT, exitCode: 1 }).attestation_hash).not.toBe(hash)
  })

  test('nothing the repository cannot verify for itself gets in', () => {
    // The schema is closed. A caller handing over a Work Item, a path or an
    // environment dump has handed over a claim the producer cannot check, and a
    // field that records whatever it was given records nothing.
    const keys = Object.keys(buildAttestation(INPUT))

    expect(keys).toEqual([
      'schema_version',
      'repository',
      'revision',
      'dirty_worktree',
      'command',
      'result',
      'exit_code',
      'started_at',
      'finished_at',
      'duration_ms',
      'environment',
      'attestation_hash',
    ])
    expect(Object.keys(buildAttestation(INPUT).environment)).toEqual(['os', 'arch', 'bun', 'ci'])
  })

  test('a revision that is not a full commit SHA is refused', () => {
    expect(() => buildAttestation({ ...INPUT, revision: '980cc07' })).toThrow(/revision/)
    expect(() => buildAttestation({ ...INPUT, revision: REVISION.toUpperCase() })).toThrow(
      /revision/
    )
  })

  test('a finish before its own start is refused rather than recorded as negative', () => {
    expect(() => buildAttestation({ ...INPUT, finishedAt: '2026-09-08T03:00:00.000Z' })).toThrow(
      /finished_at/
    )
  })

  test('an unsafe value in a bounded field is refused', () => {
    expect(() =>
      buildAttestation({
        ...INPUT,
        environment: { ...INPUT.environment, bun: '1.3.10; rm -rf /' },
      })
    ).toThrow(/environment.bun/)
    expect(() => buildAttestation({ ...INPUT, repository: '../../etc/passwd' })).toThrow(
      /repository/
    )
  })
})

describe('serialiseAttestation', () => {
  test('the same run serialises to the same bytes', () => {
    expect(serialiseAttestation(buildAttestation(INPUT))).toBe(
      serialiseAttestation(buildAttestation(INPUT))
    )
  })

  test('keys are in the schema order, and the file ends in exactly one newline', () => {
    const text = serialiseAttestation(buildAttestation(INPUT))

    expect(text.endsWith('}\n')).toBe(true)
    expect(text.endsWith('}\n\n')).toBe(false)
    expect(text).not.toContain('\r')
    expect(text.indexOf('"revision"')).toBeLessThan(text.indexOf('"command"'))
  })
})

describe('parseAttestation', () => {
  test('reads back what was written', () => {
    const attestation = buildAttestation(INPUT)

    expect(parseAttestation(serialiseAttestation(attestation))).toEqual(attestation)
  })

  test('a schema version it does not know is refused, not partially read', () => {
    const text = serialiseAttestation(buildAttestation(INPUT)).replace(
      '"schema_version": 1',
      '"schema_version": 2'
    )

    expect(() => parseAttestation(text)).toThrow(/schema_version/)
  })

  test('a missing required field is refused, naming the field', () => {
    const document = JSON.parse(serialiseAttestation(buildAttestation(INPUT))) as Record<
      string,
      unknown
    >
    delete document.revision

    expect(() => parseAttestation(JSON.stringify(document))).toThrow(/revision/)
  })

  test('a hash that does not match the content is refused', () => {
    const text = serialiseAttestation(buildAttestation(INPUT)).replace(REVISION, 'a'.repeat(40))

    expect(() => parseAttestation(text)).toThrow(/attestation_hash/)
  })

  test('a flag stated as anything but a boolean is refused, not coerced', () => {
    // `"yes"` used to rebuild as `false`, match its own hash, and be handed back
    // with the worktree flag flipped: every other reader of that file saw a
    // dirty worktree, this one saw a clean one and said nothing.
    const document = JSON.parse(serialiseAttestation(buildAttestation(INPUT))) as Record<
      string,
      unknown
    >
    document.dirty_worktree = 'yes'

    expect(() => parseAttestation(JSON.stringify(document))).toThrow(/dirty_worktree/)
  })

  test('a derived field edited under a legitimate hash is refused', () => {
    // The two comparisons are not redundant. The hash catches an edit to a
    // stated field; this catches the opposite forgery, where a derived field is
    // edited and the original hash left in place, so the rebuild still matches.
    const document = JSON.parse(serialiseAttestation(buildAttestation(INPUT))) as Record<
      string,
      unknown
    >
    document.result = 'FAIL'

    expect(() => parseAttestation(JSON.stringify(document))).toThrow(/result or duration/)
  })

  test('a field the schema does not define is refused', () => {
    const document = JSON.parse(serialiseAttestation(buildAttestation(INPUT))) as Record<
      string,
      unknown
    >
    document.work_item = 'WI-004'

    expect(() => parseAttestation(JSON.stringify(document))).toThrow(/work_item/)
  })
})

/**
 * The Security Fixture Matrix.
 *
 * An earlier version of this suite spawned the real writer, which wrote to the
 * repository's canonical `.verification/attestation.json`. That produced a
 * hash-valid PASS attestation for whatever HEAD happened to be, from a test run
 * rather than a verification — and in CI, where `bun run test` is step 10 of 24
 * and the upload step runs `if: always()`, a job killed after step 10 would
 * have published it. A test that can forge the artifact it is testing is worse
 * than no test.
 *
 * So the environment read is a function over an argument now, and the matrix is
 * asserted by handing it every payload the Story names. Nothing spawns and
 * nothing is written, which is also what makes it safe on a runner whose
 * checkout path contains a space, a non-ASCII character, or a drive letter.
 */
describe('the security fixture matrix', () => {
  const PAYLOADS = {
    DBCLI_PASSWORD: 'hunter2',
    GITHUB_TOKEN: 'ghp_000000000000000000000000000000000000',
    // Deliberately not the literal `true` most providers set: as a substring
    // that is indistinguishable from the boolean the schema records, so it
    // could not tell a copied value from a correctly derived one.
    CI: 'azure-pipelines',
    USER: 'carl',
    HOSTNAME: 'carls-macbook-air.local',
    PWD: '/Users/carl/Dev/CMG/Dbcli',
    npm_lifecycle_script: 'error: connect ECONNREFUSED 127.0.0.1:5432',
  } as const

  const hostile = () =>
    buildAttestation({
      ...INPUT,
      environment: readEnvironment({
        env: PAYLOADS,
        platform: 'linux',
        arch: 'x64',
        bun: '1.3.10',
      }),
    })

  test('no payload the Story names reaches the document', () => {
    const document = serialiseAttestation(hostile())

    for (const payload of Object.values(PAYLOADS)) {
      expect(document).not.toContain(payload)
    }
  })

  test("CI's presence is recorded, its value is not", () => {
    expect(hostile().environment.ci).toBe(true)
  })

  test('an absent CI is recorded as absent, not guessed', () => {
    const environment = readEnvironment({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      bun: '1.3.10',
    })

    expect(environment.ci).toBe(false)
  })

  test('the environment description carries four fields and nothing else', () => {
    expect(Object.keys(hostile().environment)).toEqual(['os', 'arch', 'bun', 'ci'])
  })

  test('the revision is preserved, because it is the one thing being attested', () => {
    expect(hostile().revision).toBe(REVISION)
  })
})

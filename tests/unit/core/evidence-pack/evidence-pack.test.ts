import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildEvidencePack,
  EvidencePackValidationError,
  parseEvidenceClaimsInput,
  parseEvidencePack,
  readEvidencePack,
  renderEvidencePackMarkdown,
  writeEvidencePack,
} from '@/core/evidence-pack'

const claims = {
  subject: { kind: 'migration', name: 'add_safe_index' },
  claims: [
    { id: 'claim-1', text: 'The migration completed without an observed verification failure.' },
  ],
}

const references = [
  {
    kind: 'audit' as const,
    id: '00000001-audit',
    createdAt: '2026-08-08T00:00:00.000Z',
    connectionName: 'default',
    command: 'migrate',
    success: true,
  },
]

let workspace: string | undefined
let outsideWorkspace: string | undefined

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
  if (outsideWorkspace) await rm(outsideWorkspace, { recursive: true, force: true })
  workspace = undefined
  outsideWorkspace = undefined
})

describe('evidence pack identity', () => {
  // EVD-01 asked for equivalent inputs to produce an identical pack. They could
  // not: the digest covered a random UUID id and a millisecond createdAt, so
  // composing the same claims twice produced two unrelated digests and there
  // was nothing to compare across runs.
  test('composing the same claims and references twice produces the same digest', () => {
    const first = buildEvidencePack(claims, references, {
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    })
    const second = buildEvidencePack(claims, references, {
      now: () => new Date('2026-08-09T23:59:59.000Z'),
    })
    expect(second.integrity.digest).toBe(first.integrity.digest)
    expect(second.id).toBe(first.id)
    expect(second.createdAt).not.toBe(first.createdAt)
  })

  test('derives the pack id from its content digest', () => {
    const pack = buildEvidencePack(claims, references)
    expect(pack.id).toBe(`evp_${pack.integrity.digest.slice(0, 32)}`)
  })

  test('different claims produce a different digest and id', () => {
    const pack = buildEvidencePack(claims, references)
    const other = buildEvidencePack(
      { ...claims, claims: [{ id: 'claim-1', text: 'A different claim entirely.' }] },
      references
    )
    expect(other.integrity.digest).not.toBe(pack.integrity.digest)
    expect(other.id).not.toBe(pack.id)
  })

  test('rejects a pack whose id does not match its digest', () => {
    const pack = buildEvidencePack(claims, references)
    expect(() =>
      parseEvidencePack({ ...pack, id: 'evp_0000000000000000000000000000ffff' })
    ).toThrow(/pack id does not match/)
  })

  // The digest is computed over a canonical serialization, so the key order a
  // file happens to be written in cannot change it.
  test('validates a pack whose keys are stored in a different order', () => {
    const pack = buildEvidencePack(claims, references)
    const reordered = JSON.parse(
      JSON.stringify({
        integrity: pack.integrity,
        claims: pack.claims,
        subject: pack.subject,
        createdAt: pack.createdAt,
        id: pack.id,
        version: pack.version,
      })
    )
    expect(parseEvidencePack(reordered).integrity.digest).toBe(pack.integrity.digest)
  })

  // coverage.gaps could never be non-empty: both writers hard-coded an empty
  // array and the parser rejected a non-empty one. A field that cannot vary
  // states nothing, and expiry is reported by `evidence validate` instead.
  test('does not carry a coverage field', () => {
    const pack = buildEvidencePack(claims, references)
    expect(pack).not.toHaveProperty('coverage')
  })

  test('rejects a pack that still carries the removed coverage field', () => {
    const pack = buildEvidencePack(claims, references)
    expect(() =>
      parseEvidencePack({
        ...pack,
        coverage: { completeForDeclaredEvidence: true, gaps: [] },
      })
    ).toThrow(EvidencePackValidationError)
  })

  test('createdAt is metadata and is not covered by the digest', () => {
    const pack = buildEvidencePack(claims, references)
    const restamped = parseEvidencePack({ ...pack, createdAt: '2030-01-01T00:00:00.000Z' })
    expect(restamped.integrity.digest).toBe(pack.integrity.digest)
  })
})

describe('evidence packs', () => {
  test('canonicalizes claims and produces a tamper-evident pack', () => {
    const pack = buildEvidencePack(claims, references, {
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    })

    expect(pack.id).toBe(`evp_${pack.integrity.digest.slice(0, 32)}`)
    expect(pack.claims[0]?.evidence).toEqual(references)
    expect(parseEvidencePack(JSON.parse(JSON.stringify(pack)))).toEqual(pack)

    const tampered = { ...pack, claims: [{ ...pack.claims[0]!, text: 'A different claim.' }] }
    expect(() => parseEvidencePack(tampered)).toThrow(/digest mismatch/)
  })

  test('accepts a verify receipt reference without changing its operation', () => {
    const pack = buildEvidencePack(claims, [
      {
        kind: 'receipt',
        id: 'evr_verify-1',
        createdAt: '2026-08-08T00:00:00.000Z',
        operation: 'verify',
        outcome: 'failed',
        digest: `sha256:${'a'.repeat(64)}`,
        path: '.dbcli/evidence/verify.json',
      },
    ])
    expect(
      parseEvidencePack(JSON.parse(JSON.stringify(pack))).claims[0]?.evidence[0]
    ).toMatchObject({
      kind: 'receipt',
      operation: 'verify',
      outcome: 'failed',
    })
  })

  test('rejects SQL-shaped and structurally unsafe claim input', () => {
    expect(() =>
      parseEvidenceClaimsInput({
        subject: { kind: 'migration' },
        claims: [{ id: 'claim-1', text: 'SELECT * FROM users' }],
      })
    ).toThrow(EvidencePackValidationError)

    expect(() =>
      parseEvidenceClaimsInput({
        subject: { kind: 'migration' },
        claims: [{ id: 'claim-1', text: 'FROM users WHERE id equals a value' }],
      })
    ).toThrow(/SQL/)

    expect(() =>
      parseEvidenceClaimsInput({
        subject: { kind: 'migration' },
        claims: [{ id: 'claim-1', text: 'GRANT ALL ON users TO app_role' }],
      })
    ).toThrow(/SQL/)

    for (const sql of ['CALL refresh_cache()', 'COPY users TO STDOUT', 'VACUUM users']) {
      expect(() =>
        parseEvidenceClaimsInput({
          subject: { kind: 'migration' },
          claims: [{ id: 'claim-1', text: sql }],
        })
      ).toThrow(/SQL/)
    }

    expect(() =>
      parseEvidenceClaimsInput({
        subject: { kind: 'migration' },
        claims: [{ id: 'claim-1', text: 'The password=not-safe value was visible.' }],
      })
    ).toThrow(/credentials or error/)

    expect(
      parseEvidenceClaimsInput({
        subject: { kind: 'migration' },
        claims: [{ id: 'claim-1', text: 'The update passed review.' }],
      })
    ).toEqual({
      subject: { kind: 'migration' },
      claims: [{ id: 'claim-1', text: 'The update passed review.' }],
    })

    expect(() =>
      parseEvidenceClaimsInput({
        subject: { kind: 'migration', target: 'users' },
        claims: [{ id: 'claim-1', text: 'Completed.' }],
      })
    ).toThrow(/unknown field/)
  })

  test('writes only inside the workspace and refuses to overwrite a pack', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'dbcli-evidence-pack-'))
    outsideWorkspace = await mkdtemp(join(tmpdir(), 'dbcli-evidence-outside-'))
    const pack = buildEvidencePack(claims, references)
    const output = await writeEvidencePack(workspace, '.dbcli/evidence/pack.json', pack)

    expect(await readEvidencePack(output)).toEqual(pack)
    await expect(writeEvidencePack(workspace, '.dbcli/evidence/pack.json', pack)).rejects.toThrow(
      /already exists/
    )
    await expect(writeEvidencePack(workspace, '../escape.json', pack)).rejects.toThrow(
      /inside the workspace/
    )
    await symlink(outsideWorkspace, join(workspace, 'outside'))
    await expect(writeEvidencePack(workspace, 'outside/new/escape.json', pack)).rejects.toThrow(
      /resolves outside the workspace/
    )
    await expect(stat(join(outsideWorkspace, 'new'))).rejects.toThrow()
  })

  test('escapes untrusted prose when rendering Markdown', () => {
    const pack = buildEvidencePack(
      {
        subject: { kind: 'migration', name: '<review>' },
        claims: [{ id: 'claim-1', text: 'See [untrusted](payload) before review.' }],
      },
      references
    )

    expect(renderEvidencePackMarkdown(pack)).toContain(
      'See \\[untrusted\\]\\(payload\\) before review.'
    )
  })
})

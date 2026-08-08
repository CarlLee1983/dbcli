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

describe('evidence packs', () => {
  test('canonicalizes claims and produces a tamper-evident pack', () => {
    const pack = buildEvidencePack(claims, references, {
      now: () => new Date('2026-08-08T12:00:00.000Z'),
      idFactory: () => 'evp_test-1',
    })

    expect(pack.id).toBe('evp_test-1')
    expect(pack.claims[0]?.evidence).toEqual(references)
    expect(parseEvidencePack(JSON.parse(JSON.stringify(pack)))).toEqual(pack)

    const tampered = { ...pack, claims: [{ ...pack.claims[0]!, text: 'A different claim.' }] }
    expect(() => parseEvidencePack(tampered)).toThrow(/digest mismatch/)
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
    const pack = buildEvidencePack(claims, references, { idFactory: () => 'evp_test-2' })
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
      references,
      { idFactory: () => 'evp_test-3' }
    )

    expect(renderEvidencePackMarkdown(pack)).toContain(
      'See \\[untrusted\\]\\(payload\\) before review.'
    )
  })
})

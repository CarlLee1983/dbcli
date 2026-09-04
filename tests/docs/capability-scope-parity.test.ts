/**
 * The reference cannot describe a catalog scope the catalog does not have.
 *
 * `assets/reference.md` used to name twelve commands as deliberately absent
 * from the catalog — an accurate, useful sentence that became false the moment
 * DBCLI-PLAT-011 added them. That kind of sentence is the one worth guarding:
 * it is specific enough to be trusted, and nothing about adding a capability
 * makes anyone open the reference.
 *
 * So the check is not "the prose mentions the right words". It is: no command
 * the catalog covers is described in the reference as absent from it, derived
 * from the live catalog rather than from a second list.
 */

import { describe, test, expect } from 'bun:test'
import { CAPABILITIES } from '@/core/capabilities'

/** Every reference surface, source and generated mirrors alike. */
const SURFACES = [
  'assets/reference.md',
  'skills/dbcli/reference.md',
  'plugins/dbcli-agent/skills/dbcli/reference.md',
  '.cursor/skills/dbcli/reference.md',
  '.github/skills/dbcli/reference.md',
  '.windsurf/skills/dbcli/reference.md',
]

const read = (file: string) => Bun.file(new URL(`../../${file}`, import.meta.url)).text()

/** The top-level command of every catalogued path. */
const catalogued = [...new Set(CAPABILITIES.map((c) => c.command.split(' ')[0] as string))].sort()

describe('the reference describes the catalog that exists', () => {
  for (const file of SURFACES) {
    test(`${file} claims no catalogued command is absent`, async () => {
      const source = await read(file)
      const absence = source.match(/are absent rather than described[\s\S]{0,400}/)
      if (!absence) return

      const named = catalogued.filter((command) =>
        new RegExp(`\`${command}\``).test(absence[0] as string)
      )
      expect({ file, wronglyCalledAbsent: named }).toEqual({ file, wronglyCalledAbsent: [] })
    })

    test(`${file} does not still call the catalog "v1 scope"`, async () => {
      // The paragraph's old heading. Kept as its own assertion because the
      // sentence could be rewritten while the stale heading survived above it.
      expect(await read(file)).not.toContain('**Scope of v1:**')
    })
  }

  test('the catalog covers the commands the reference now names', async () => {
    const reference = await read('assets/reference.md')
    for (const command of [
      'explain',
      'plan',
      'assert',
      'snapshot',
      'verify',
      'verification',
      'evidence',
      'contract',
      'semantic',
      'design',
      'proxy',
      'recovery',
      'password',
      'capabilities',
    ]) {
      expect({ command, catalogued: catalogued.includes(command) }).toEqual({
        command,
        catalogued: true,
      })
      expect(reference).toContain(`\`${command}\``)
    }
  })
})

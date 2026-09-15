/**
 * What the capability catalog must not break, stated as assertions.
 *
 * ADR-0039 replaced three frozen sha256 hashes of the rendered catalog with
 * this. The hashes moved whenever `ENGINE_CAPABILITIES` moved — which ADR-0022
 * makes routine, since the catalog is derived from that matrix — so their only
 * expected repair was to write down whatever the renderer said now. These
 * checks state the contract instead: the document parses at the pinned schema
 * version, every capability names a command the CLI actually carries, and the
 * three renderings describe the same catalog.
 *
 * They live outside the test files so the same rules guard the rendered
 * document in `tests/integration/lazy-entry-path.test.ts` and the declared
 * table in `tests/contract/capability-catalog.test.ts`, and so a failure can be
 * shown on a deliberately broken catalog rather than only asserted to be
 * possible.
 */

import { parseCapabilityCatalog } from '@/core/capabilities/schema'
import type { CapabilityCatalog } from '@/core/capabilities'

export class CatalogContractViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogContractViolation'
    Object.setPrototypeOf(this, CatalogContractViolation.prototype)
  }
}

/**
 * The JSON rendering parses as a catalog of the pinned schema version.
 *
 * `parseCapabilityCatalog` is the same validator an external Skill is told to
 * use, so a document that fails here fails for its consumers too, and its
 * message names the field rather than reporting that a hash differs.
 */
export function assertCatalogDocument(json: string): CapabilityCatalog {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new CatalogContractViolation(
      `capability catalog JSON does not parse: ${(error as Error).message}`
    )
  }
  const catalog = parseCapabilityCatalog(value)
  if (catalog.capabilities.length === 0) {
    throw new CatalogContractViolation('capability catalog lists no capabilities')
  }
  return catalog
}

/**
 * Every capability names a command path the CLI carries.
 *
 * `carries` is supplied by the caller so this can be run against the live
 * Commander tree and against a deliberately dead path, and the message names
 * the capability and the path — the two things a reader needs to fix it.
 */
export function assertCommandsAreLive(
  catalog: CapabilityCatalog,
  carries: (path: string) => boolean
): void {
  const dead = catalog.capabilities
    .filter((capability) => !carries(capability.command))
    .map((capability) => `${capability.id} -> \`dbcli ${capability.command}\``)
  if (dead.length > 0) {
    throw new CatalogContractViolation(
      `capability catalog names ${dead.length} command path(s) the CLI does not carry: ${dead.join(', ')}`
    )
  }
}

/**
 * The text and Markdown renderings describe the same catalog as the JSON.
 *
 * The hashes pinned all three separately, which detected a renderer drifting
 * from its siblings only by reporting that all three had changed. Comparing
 * them to each other is the claim that was actually worth keeping: a capability
 * the JSON lists and the Markdown table omits is a catalog that answers
 * differently depending on which format the caller asked for.
 */
export function assertRenderingsAgree(
  catalog: CapabilityCatalog,
  renderings: { text: string; markdown: string }
): void {
  for (const [format, rendered] of Object.entries(renderings)) {
    const missing = catalog.capabilities
      .filter((capability) => !rendered.includes(capability.id))
      .map((capability) => capability.id)
    if (missing.length > 0) {
      throw new CatalogContractViolation(
        `${format} rendering omits ${missing.length} capability/capabilities the JSON lists: ${missing.join(', ')}`
      )
    }
    const declared = rendered.match(/(\d+) capabilities/)
    if (declared && Number(declared[1]) !== catalog.capabilities.length) {
      throw new CatalogContractViolation(
        `${format} rendering says ${declared[1]} capabilities; the JSON lists ${catalog.capabilities.length}`
      )
    }
  }
}

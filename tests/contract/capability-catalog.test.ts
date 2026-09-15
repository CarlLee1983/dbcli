/**
 * The catalog document's contract, against the live command tree.
 *
 * `capability-contract.test.ts` asserts the declared table — `CAPABILITIES` as
 * the process holds it. This file asserts the *rendered* catalog, which is what
 * an external Skill reads, and it is the half the three sha256 hashes in
 * `legacy-surface-baseline.json` used to stand in for. ADR-0039 replaced them
 * because the catalog is derived from `ENGINE_CAPABILITIES` (ADR-0022), so the
 * hashes moved on every engine change and reported only that something moved.
 *
 * The rule that survives the derivation is this one: a capability may not name
 * a command the CLI does not carry. A catalog that does is discoverable and
 * wrong — a Skill would call a command that does not exist.
 */

import { describe, expect, test } from 'bun:test'
import { buildProgram } from '@/program'
import { buildCompletionTree, findCommandPath } from '@/core/completion/command-tree'
import { buildCapabilityCatalog } from '@/core/capabilities'
import {
  assertCatalogDocument,
  assertCommandsAreLive,
  CatalogContractViolation,
} from '../helpers/capability-catalog-contract'

const tree = buildCompletionTree(buildProgram())
const carries = (path: string): boolean => findCommandPath(tree, path.split(' ')) !== undefined

describe('capability catalog document', () => {
  const catalog = assertCatalogDocument(JSON.stringify(buildCapabilityCatalog()))

  test('every capability names a command the CLI carries', () => {
    assertCommandsAreLive(catalog, carries)
  })

  test('a capability naming a dead command path fails, and the message names it', () => {
    const victim = catalog.capabilities[0]!
    const broken = {
      ...catalog,
      capabilities: [
        { ...victim, command: 'definitely not a command' },
        ...catalog.capabilities.slice(1),
      ],
    }

    let thrown: unknown
    try {
      assertCommandsAreLive(assertCatalogDocument(JSON.stringify(broken)), carries)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CatalogContractViolation)
    expect((thrown as Error).message).toContain(victim.id)
    expect((thrown as Error).message).toContain('definitely not a command')
  })
})

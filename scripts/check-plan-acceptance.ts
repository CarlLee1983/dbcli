/**
 * Gate: every acceptance criterion in docs/plans states whether it is proven.
 *
 * The 2026-08-08 evidence backlog was closed and shipped in v1.53.0 while all
 * eight of its tickets still read `Status: Proposed`, and two of its acceptance
 * criteria described behavior the code cannot produce. Nothing caught either,
 * because a plan document is prose and prose drifts silently. This gate makes
 * the drift loud: each criterion must end with `— covered by:` naming the test
 * that asserts it, `— unverified:` admitting nothing does, or
 * `— known deviation:` recording that it is deliberately unmet.
 *
 * It enforces disclosure, not coverage. Annotating everything `— unverified:`
 * passes, and that is the intended trade: a gate that demanded real tests would
 * be argued down to a rubber stamp, while one that only demands an honest label
 * survives contact and leaves the count visible in review. The one substantive
 * check is that a cited test file exists — a fabricated citation is the failure
 * this gate exists to prevent, and it is the half that can be checked cheaply.
 * That a cited test actually asserts its criterion is not checkable here.
 *
 * PLAN_ACCEPTANCE_EXEMPTIONS is a ratchet, not an amnesty. Every entry is a
 * plan that predates the convention. The list may shrink and never grow: a
 * contract test fails if an entry no longer needs its exemption (annotate it,
 * then delete the line), and this gate fails for any other plan.
 *
 * docs/plans/done/ is not scanned. It is an archive of finished work, and
 * rewriting closed plans to satisfy a later convention would destroy the record
 * this gate is trying to protect.
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../docs/plans/', import.meta.url)
const rootPath = fileURLToPath(root)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Plans written before acceptance criteria had to declare their evidence.
 *
 * File names relative to docs/plans. Only ever remove entries.
 */
export const PLAN_ACCEPTANCE_EXEMPTIONS: readonly string[] = [
  '2026-08-06-semantic-query-draft-ticket-backlog.md',
]

const MARKERS = ['covered by', 'unverified', 'known deviation'] as const

const ACCEPTANCE_HEADING = /^\*\*Acceptance criteria:\*\*(.*)$/
const BOLD_FIELD = /^\*\*[^*]+:\*\*/
const TICKET_HEADING = /^##\s+(\S+)/
const CRITERION_START = /^(\d+)\.\s+(.*)$/
const CITED_TEST = /tests\/[A-Za-z0-9_\-./]+\.test\.ts/g

const MISSING_ANNOTATION = MARKERS.map((marker) => `— ${marker}:`).join(' / ')

type Criterion = { number: string; text: string }

/**
 * Collect the numbered criteria that follow an acceptance heading.
 *
 * The section ends at the next bold field, ticket heading, or rule, so a
 * numbered list elsewhere in the ticket is not mistaken for a criterion.
 */
function readCriteria(lines: readonly string[], start: number): Criterion[] {
  const criteria: Criterion[] = []

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (
      index > start &&
      (BOLD_FIELD.test(line) || TICKET_HEADING.test(line) || /^---\s*$/.test(line))
    ) {
      break
    }

    const started = CRITERION_START.exec(line)
    if (started) {
      criteria.push({ number: started[1] ?? '', text: started[2] ?? '' })
      continue
    }

    const current = criteria.at(-1)
    if (current) current.text = `${current.text} ${line}`
  }

  return criteria
}

/**
 * Report one violation per unannotated, emptily annotated, or unlisted
 * criterion, in document order.
 */
export function findPlanAcceptanceViolations(source: string, relativePath: string): string[] {
  const lines = source.split('\n')
  const violations: string[] = []
  let ticket = '(no ticket heading)'

  for (const [index, line] of lines.entries()) {
    const heading = TICKET_HEADING.exec(line)
    if (heading) {
      ticket = heading[1] ?? ticket
      continue
    }

    const acceptance = ACCEPTANCE_HEADING.exec(line)
    if (!acceptance) continue

    const criteria = readCriteria(lines, index + 1)
    if (criteria.length === 0) {
      violations.push(
        `${relativePath}: ${ticket} states acceptance criteria without a numbered list`
      )
      continue
    }

    for (const criterion of criteria) {
      // The annotation is prose inside a wrapped list item, so its marker is
      // routinely split by a line break. Compare on collapsed whitespace.
      const normalized = criterion.text.replace(/\s+/g, ' ').trim()
      const marker = MARKERS.find((candidate) => normalized.includes(`— ${candidate}:`))

      if (!marker) {
        violations.push(
          `${relativePath}: ${ticket} criterion ${criterion.number} carries no ${MISSING_ANNOTATION} annotation`
        )
        continue
      }

      const said = normalized
        .slice(normalized.indexOf(`— ${marker}:`) + `— ${marker}:`.length)
        .trim()
      if (said.length === 0) {
        violations.push(
          `${relativePath}: ${ticket} criterion ${criterion.number} has an empty — ${marker}: annotation`
        )
      }
    }
  }

  return violations
}

/**
 * Every test path cited anywhere in a plan, sorted and deduplicated.
 */
export function findCitedTestPaths(source: string): string[] {
  return [...new Set(source.match(CITED_TEST) ?? [])].sort()
}

/**
 * Scan docs/plans, skipping the exemption list and the done/ archive.
 */
export async function collectPlanAcceptanceViolations(): Promise<string[]> {
  const exempt = new Set(PLAN_ACCEPTANCE_EXEMPTIONS)
  const violations: string[] = []

  for await (const scanned of new Bun.Glob('*.md').scan({ cwd: rootPath })) {
    const name = scanned.replaceAll('\\', '/')
    if (exempt.has(name)) continue

    const source = await Bun.file(join(rootPath, name)).text()
    violations.push(...findPlanAcceptanceViolations(source, name))

    for (const cited of findCitedTestPaths(source)) {
      if (!(await Bun.file(join(repoRoot, cited)).exists())) {
        violations.push(`${name}: cites ${cited}, which does not exist`)
      }
    }
  }

  return violations.sort()
}

if (import.meta.main) {
  const violations = await collectPlanAcceptanceViolations()

  if (violations.length > 0) {
    console.error(
      `plan acceptance check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n\n` +
        `Every acceptance criterion ends with ${MISSING_ANNOTATION} — say which, even when the answer is that nothing proves it.`
    )
    process.exit(1)
  }

  console.log('plan acceptance check passed')
}

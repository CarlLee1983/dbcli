/**
 * Content contract: every in-page anchor in reference.md resolves.
 *
 * The file is ~3300 lines, so the index at the top is how an agent avoids reading
 * all of it. A renamed heading breaks a link silently — nothing else in the build
 * looks at anchors — and the failure mode is an agent that reads the whole file
 * instead. This derives the anchors from the headings themselves.
 */

import { describe, expect, test } from 'bun:test'

const GITHUB_ANCHOR = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .trim()
    .replace(/ /g, '-')

const source = await Bun.file('assets/reference.md').text()

function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>()
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) anchors.add(GITHUB_ANCHOR(heading[1]!.trim()))
  }
  return anchors
}

describe('reference.md index', () => {
  const anchors = headingAnchors(source)

  test('every in-page link points at a real heading', () => {
    const broken = [...source.matchAll(/\]\(#([^)]+)\)/g)]
      .map((match) => match[1]!)
      .filter((anchor) => !anchors.has(anchor))

    expect(broken).toEqual([])
  })

  test('the index covers every top-level section', () => {
    const sections = [...source.matchAll(/^## (.+)$/gm)]
      .map((match) => GITHUB_ANCHOR(match[1]!.trim()))
      .filter((anchor) => anchor !== 'index')

    const linked = new Set([...source.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]!))
    expect(sections.filter((anchor) => !linked.has(anchor))).toEqual([])
  })

  test('the index covers every documented command', () => {
    const commandsBody = source.slice(
      source.indexOf('\n## Commands'),
      source.indexOf('\n## Recovery Cookbook')
    )
    const commands = [...commandsBody.matchAll(/^### (.+)$/gm)].map((match) =>
      GITHUB_ANCHOR(match[1]!.trim())
    )

    const index = source.slice(0, source.indexOf('\n## Global options'))
    const linked = new Set([...index.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]!))

    expect(commands.filter((anchor) => !linked.has(anchor))).toEqual([])
  })
})

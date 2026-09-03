/**
 * Shared reading and normalization for the documentation-contract tests.
 *
 * Four tests assert that a published claim appears on all four
 * `docs/user/{en,zh-TW}/index.{md,html}` surfaces. They all read the file the
 * same way and all strip markup and decode entities before matching, so those
 * steps live here.
 *
 * What is deliberately NOT shared is the rest of each pipeline. The four
 * normalizations are not the same: `impact` never lowercases and does not
 * collapse CJK line wraps, and `verification-receipt` closes the space around
 * bracket and CJK punctuation and strips markup before locating its section
 * rather than after. Folding them into one function would silently widen or
 * narrow what each delivered Story's claims match, which is why this
 * unification was refused twice before. Each caller keeps its own tail and its
 * own section scoping; only the byte-identical parts moved here.
 */

/** Raw file text with only line endings normalized. */
export async function readDocSource(path: string): Promise<string> {
  // Windows checks out CRLF, so line endings are not part of any claim.
  return (await Bun.file(path).text()).replace(/\r\n/g, '\n')
}

/** Removes tags and decodes the entities the published surfaces use. */
export function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Collapses the Markdown hard wraps that would otherwise split a CJK claim.
 *
 * A newline between two CJK characters is that wrap and nothing else, so it
 * disappears; every other newline is left for the caller to collapse to a
 * space, which is what a wrap between CJK and a Latin word stood for. Only a
 * newline counts: matching any whitespace would also join two sentences across
 * a full stop, letting a claim span text the document never wrote as one
 * statement.
 */
export function collapseCjkWraps(text: string): string {
  return text
    .replace(
      /([\u3000-\u303f\u3400-\u9fff\uff00-\uffef])\n\s*(?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/g,
      '$1'
    )
    .replace(/([、。，；：！？])\n[ \t]*/g, '$1')
}

/**
 * The source text between one `<!-- doc-key: ... -->` marker and the next.
 *
 * The markers are the most robust section boundary available: both the
 * Markdown and the HTML carry them, so an unrelated section cannot satisfy a
 * claim. Slicing happens before `stripMarkup`, which would otherwise delete
 * the markers along with every other tag. Returns null when the section is
 * absent or unterminated, so a silently empty section cannot pass.
 */
export function docKeySection(source: string, key: string): string | null {
  const marker = `<!-- doc-key: ${key} -->`
  const start = source.indexOf(marker)
  if (start < 0) return null
  const end = source.indexOf('<!-- doc-key:', start + marker.length)
  if (end <= start) return null
  return source.slice(start, end)
}

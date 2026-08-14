/**
 * @inquirer/prompts has to reach the user, and only two arrangements do that.
 *
 * It was neither: declared as a devDependency and left to the bundler, which
 * inlined the prompt implementations on some builds and tree-shook them away on
 * others (#56) — leaving an intact barrel whose import threw, so every
 * interactive prompt degraded to plain text with no error anywhere. The npm
 * package ships `dist/` only, so a devDependency the bundle failed to inline is
 * simply absent on the user's machine.
 *
 * Marking it external makes the bundle emit a real import, which only resolves
 * if it is a runtime dependency. The two facts are one decision, and this pins
 * them together: changing either half alone reintroduces the silent fallback.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

const PACKAGE = '@inquirer/prompts'

const manifest = (await Bun.file('package.json').json()) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  files?: string[]
}
const buildScript = await Bun.file('scripts/build.ts').text()

/**
 * Bundles that can reach a prompt.
 *
 * `dist/core.mjs` used to be one of them. Core no longer prompts or prints —
 * it reports what is about to happen and the command layer asks — so the ./core
 * subpath has no path to @inquirer/prompts at all, and the assertion below
 * inverts for it: absence is now the contract, checked so the edge cannot
 * reappear unnoticed.
 */
const PROMPT_BEARING_BUNDLES = ['dist/cli-runtime.mjs']
const PROMPT_FREE_BUNDLES = ['dist/core.mjs']
const ALL_CHECKED_BUNDLES = [...PROMPT_BEARING_BUNDLES, ...PROMPT_FREE_BUNDLES]

describe('@inquirer/prompts shipping contract', () => {
  test('is a runtime dependency, not a devDependency', () => {
    expect(manifest.dependencies?.[PACKAGE]).toBeString()
    expect(manifest.devDependencies?.[PACKAGE]).toBeUndefined()
  })

  test.each(PROMPT_BEARING_BUNDLES)('the build marks it external for %s', (outfile) => {
    const command = buildScript.split('\n').find((line) => line.includes(`--outfile ${outfile}`))

    expect(command).toBeString()
    expect(command).toContain(`--external ${PACKAGE}`)
  })

  // The two tests above pin the intent; this one pins the result. Skipped when
  // dist/ is absent so the suite still runs pre-build.
  describe.if(ALL_CHECKED_BUNDLES.every((path) => existsSync(path)))('built artifacts', () => {
    test.each(PROMPT_BEARING_BUNDLES)('%s imports it rather than inlining it', async (outfile) => {
      const bundle = await Bun.file(outfile).text()

      // An external dependency survives as a real import specifier. An inlined
      // one leaves Bun's module comment instead — and that is the arrangement
      // that shipped a barrel without its implementations.
      expect(bundle).toMatch(/import\(["']@inquirer\/prompts["']\)/)
      expect(bundle).not.toContain('// node_modules/@inquirer/prompts/')
    })

    test.each(PROMPT_FREE_BUNDLES)('%s cannot reach a prompt at all', async (outfile) => {
      // Not a size optimisation: a core that can prompt is a core that can
      // block on stdin and write to stdout, which is the thing the layering
      // rule exists to prevent. If this fails, something in src/core started
      // asking the user questions again.
      expect(await Bun.file(outfile).text()).not.toContain(PACKAGE)
    })
  })

  test('the published package ships dist/, which is why the above matters', () => {
    // If `files` ever grew node_modules or the sources, bundling would become a
    // size decision again rather than a correctness one — and this whole file
    // would be arguing about the wrong thing.
    expect(manifest.files).toContain('dist/')
    expect(manifest.files).not.toContain('node_modules/')
  })
})

/**
 * Guards the one property of the test environment that a network-speaking
 * adapter depends on: `fetch` is the runtime's, not happy-dom's.
 *
 * happy-dom is preloaded for every test process so that the UI render smoke
 * test has a DOM, and Bun shares a process across test files, so its globals
 * are visible everywhere regardless of who asked. Its `fetch` enforces a
 * same-origin policy, which made every Elasticsearch integration assertion
 * silently skip for months behind a "container not running" message while the
 * container was running (#109).
 *
 * `window` is deliberately not asserted on: it is still registered, and
 * shadowing it is harmless. The `fetch` identity is the whole contract.
 */
import { test, expect } from 'bun:test'
import { runtimeFetch } from '../../helpers/setup-happy-dom'

test("fetch is the runtime implementation, not happy-dom's same-origin one", () => {
  expect(globalThis.fetch).toBe(runtimeFetch)
})

test('a cross-origin response is readable rather than blocked', async () => {
  // The shape that broke: a server answering with no CORS headers. Skipped
  // when nothing is listening, since this asserts about the fetch in use, not
  // about the container being up.
  const response = await fetch('http://localhost:9201/').catch((error: Error) => error)

  if (response instanceof Error) {
    expect(response.message).not.toContain('Cross-Origin')
    return
  }

  expect(response.status).toBe(200)
})

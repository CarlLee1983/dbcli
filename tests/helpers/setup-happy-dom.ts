/**
 * Registers happy-dom's browser globals for the test run, without letting its
 * `fetch` govern real network calls.
 *
 * happy-dom's `fetch` enforces a same-origin policy. Elasticsearch is the only
 * adapter that speaks HTTP, and its server answers `GET /` with no CORS
 * headers, so `connect()` threw `Cross-Origin Request Blocked` inside
 * `bun test` while `curl` and a plain `bun -e` script reached the same
 * container without trouble. `tests/integration/elasticsearch.test.ts` caught
 * that in a `try`/`catch` and reported "container not running", so the whole
 * file silently asserted nothing on every machine and in CI for as long as this
 * registration existed (#109).
 *
 * Scoping the registration to the one file that needs a DOM does not fix it:
 * Bun runs test files in a shared process, so the globals leak into whatever
 * else lands in that process and the outcome depends on file order. A preload
 * is at least deterministic, so what changed is the `fetch`, not the timing.
 *
 * Restore fetch's abort primitives with it. Mixing Bun's native fetch with
 * happy-dom's AbortSignal makes the Elasticsearch adapter's timed requests
 * throw before any HTTP request is sent. DOM globals remain available to UI
 * tests; no adapter constructs Request or XMLHttpRequest directly.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'

/** The runtime's `fetch`, captured before happy-dom can replace it. */
export const runtimeFetch = globalThis.fetch
export const runtimeAbortController = globalThis.AbortController
export const runtimeAbortSignal = globalThis.AbortSignal

// Bun loads `preload` files once per test process. Guard against double
// registration when individual test files import this helper directly.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  GlobalRegistrator.register()
}

globalThis.fetch = runtimeFetch
globalThis.AbortController = runtimeAbortController
globalThis.AbortSignal = runtimeAbortSignal

// Recharts' ResponsiveContainer relies on ResizeObserver; happy-dom does not
// implement it. Provide a no-op shim so the smoke test does not crash. We
// deliberately keep this minimal — the smoke test does not assert chart
// contents.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

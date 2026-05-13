import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Bun loads `preload` files once per test process. Guard against double
// registration when individual test files import this helper directly.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  GlobalRegistrator.register()
}

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

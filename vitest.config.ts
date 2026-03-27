import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      FORCE_COLOR: '1',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    } as any,
    benchmark: {
      include: ['tests/perf/**/*.bench.ts'],
      exclude: ['node_modules'],
      outputJson: './benchmarks/results.json',
      outputFile: './benchmarks/results.html'
    }
  },
})

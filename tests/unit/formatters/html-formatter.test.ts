import { test, expect, beforeAll } from 'bun:test'
import { generateHtmlReport } from '../../../src/formatters/html-formatter'
import { packageAssetPath } from '../../../src/utils/package-root'
import { $ } from 'bun'

beforeAll(async () => {
  // Ensure the UI template exists for tests
  const templatePath = packageAssetPath('ui-template.html')
  if (!(await Bun.file(templatePath).exists())) {
    console.log('Building UI template for tests...')
    await $`bun run scripts/build.ts`
  }
})

test('generateHtmlReport injects payload into template', async () => {
  const payload = {
    meta: { name: 'Test Report', key: '@test', params: [], tags: [] },
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
  }

  const html = await generateHtmlReport(payload)

  expect(html).toContain('<title>dbcli Interactive Report</title>')
  expect(html).toContain('window.__DBCLI_PAYLOAD__ = {')
  expect(html).toContain('"name":"Test Report"')
  expect(html).toContain('"rows":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]')
})

test('generateHtmlReport escapes < to prevent script injection', async () => {
  const payload = {
    meta: { name: 'XSS Test', key: '@xss', params: [], tags: [] },
    rows: [{ content: '</script><script>alert(1)</script>' }],
  }

  const html = await generateHtmlReport(payload)

  // Should NOT contain the literal </script> in the payload injection
  expect(html).not.toContain('</script><script>')
  // Should contain the escaped version
  expect(html).toContain('\\u003c/script>\\u003cscript>')
})

test('generateHtmlReport handles empty rows', async () => {
  const payload = {
    meta: { name: 'Empty Report', key: '@empty', params: [], tags: [] },
    rows: [],
  }

  const html = await generateHtmlReport(payload)
  expect(html).toContain('"rows":[]')
})

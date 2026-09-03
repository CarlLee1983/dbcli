import { test, expect, beforeAll } from 'bun:test'
import {
  generateHtmlReport,
  type DashboardDisplayInput,
} from '../../../src/formatters/html-formatter'
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

const provenance = {
  version: 1,
  connection: { name: 'analytics', system: 'postgresql' },
  savedQuery: { key: '@dau', source: 'shared' },
  permission: 'query-only',
  limit: { state: 'not-applied', truncated: false },
}

test('generateHtmlReport injects payload into template', async () => {
  const payload = {
    meta: { name: 'Test Report' },
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
    meta: { name: 'XSS Test' },
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
    meta: { name: 'Empty Report' },
    rows: [],
  }

  const html = await generateHtmlReport(payload)
  expect(html).toContain('"rows":[]')
})

test('generateHtmlReport serializes truncation and security metadata', async () => {
  const html = await generateHtmlReport({
    meta: { name: 'Bounded Report' },
    rows: [{ id: 1 }],
    appliedLimit: { truncated: true, limitApplied: 1 },
    securityNotification: 'Security: secret omitted',
  })

  expect(html).toContain('"appliedLimit":{"truncated":true,"limitApplied":1}')
  expect(html).toContain('"securityNotification":"Security: secret omitted"')
})

test('generateHtmlReport embeds validated provenance', async () => {
  const html = await generateHtmlReport({
    meta: { name: 'Traceable Report' },
    rows: [{ id: 1 }],
    provenance,
  })

  expect(html).toContain('"provenance":{"version":1')
  expect(html).toContain('"connection":{"name":"analytics","system":"postgresql"}')
  expect(html).toContain('"savedQuery":{"key":"@dau","source":"shared"}')
  expect(html).toContain('"limit":{"state":"not-applied","truncated":false}')
})

test('generateHtmlReport rejects provenance that disagrees with the truncation warning', async () => {
  await expect(
    generateHtmlReport({
      meta: { name: 'Disagreeing Report' },
      rows: [{ id: 1 }],
      appliedLimit: { truncated: true, limitApplied: 1 },
      provenance,
    })
  ).rejects.toThrow(/no applied limit but the execution applied one/)

  await expect(
    generateHtmlReport({
      meta: { name: 'Disagreeing Report' },
      rows: [{ id: 1 }],
      provenance: { ...provenance, limit: { state: 'applied', limitApplied: 5, truncated: true } },
    })
  ).rejects.toThrow(/an applied limit but the execution applied none/)

  await expect(
    generateHtmlReport({
      meta: { name: 'Disagreeing Report' },
      rows: [{ id: 1 }],
      appliedLimit: { truncated: true, limitApplied: 10 },
      provenance: { ...provenance, limit: { state: 'applied', limitApplied: 5, truncated: true } },
    })
  ).rejects.toThrow(/disagrees with the applied-limit metadata/)
})

test('generateHtmlReport rejects unsafe provenance before writing HTML', async () => {
  await expect(
    generateHtmlReport({
      meta: { name: 'Unsafe Report' },
      rows: [{ id: 1 }],
      provenance: { ...provenance, sqlBody: 'SELECT secret FROM vault' },
    })
  ).rejects.toThrow(/unknown field/)
})

test('the emitted HTML excludes every canary seeded outside the displayed result', async () => {
  const canaries = {
    queryBody: 'CANARY_QUERY_BODY',
    paramDefault: 'CANARY_PARAM_DEFAULT',
    paramEnum: 'CANARY_PARAM_ENUM',
    verifyQuery: 'CANARY_VERIFY_QUERY',
    verifyExpects: 'CANARY_VERIFY_EXPECTS',
    credential: 'CANARY_CREDENTIAL',
    endpoint: 'CANARY_ENDPOINT',
    sourcePath: 'CANARY_SOURCE_PATH',
    blockedColumn: 'CANARY_BLOCKED_COLUMN',
    undisplayedRow: 'CANARY_UNDISPLAYED_ROW',
  }

  const html = await generateHtmlReport({
    meta: {
      name: 'Canary Report',
      description: 'safe description',
      visual: {
        title: 'Canary',
        kpis: [
          { label: 'Visible', value_column: 'visible' },
          { label: 'Blocked', value_column: canaries.blockedColumn },
        ],
        charts: [{ type: 'line', x: 'visible', y: [canaries.blockedColumn] }],
      },
      // Fields the allowlist must never serialize.
      key: canaries.sourcePath,
      params: [
        {
          name: 'p',
          type: 'string',
          required: false,
          default: canaries.paramDefault,
          enum: [canaries.paramEnum],
        },
      ],
      tags: [canaries.queryBody],
      index: canaries.endpoint,
      target: canaries.credential,
      verify: { query: canaries.verifyQuery, expects: canaries.verifyExpects },
    } as unknown as DashboardDisplayInput,
    // Only the displayed rows travel; the undisplayed one never reaches the payload.
    rows: [{ visible: 1 }],
    provenance,
  })

  for (const canary of Object.values(canaries)) {
    expect(html).not.toContain(canary)
  }
})

test('a user-controlled </script> canary stays encoded inside the injected payload', async () => {
  const html = await generateHtmlReport({
    meta: { name: '</script><img src=x onerror=alert(1)>' },
    rows: [{ note: '</script><script>alert(2)</script>' }],
    provenance: { ...provenance, connection: { name: '</script>', system: 'postgresql' } },
  })

  const payloadScript = html.slice(
    html.indexOf('<script id="dbcli-payload">'),
    html.indexOf('<script id="dbcli-script">')
  )

  expect(payloadScript).toContain('window.__DBCLI_PAYLOAD__ = {')
  // The payload script element is terminated exactly once, by the template.
  expect(payloadScript.match(/<\/script>/g)).toHaveLength(1)
  expect(payloadScript).not.toContain('<img')
  expect(payloadScript).toContain('\\u003c/script>')
})

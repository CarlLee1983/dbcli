import { describe, expect, test } from 'bun:test'
import {
  MAX_OPERATION_ENVELOPE_BYTES,
  OPERATION_ENVELOPE_SCHEMA_VERSION,
  parseOperationEnvelope,
  serializeOperationEnvelope,
  type OperationEnvelope,
} from '@/core/operation-envelope'
import { buildCapabilityCatalog } from '@/core/capabilities'
import type { RecoveryEnvelope } from '@/core/recovery/types'

function successEnvelope(): OperationEnvelope {
  return {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: true,
    operation: 'capabilities.check',
    status: 'succeeded',
    context: {
      engine: 'postgresql',
      permission: 'query-only',
      connectionName: 'primary',
      agentMode: false,
    },
    data: {
      required: ['schema.read'],
      results: [{ id: 'schema.read', status: 'available', reason: null }],
    },
    warnings: [],
    evidence: [],
    recovery: null,
    error: null,
  }
}

function catalogSuccessEnvelope(): OperationEnvelope {
  return {
    schemaVersion: OPERATION_ENVELOPE_SCHEMA_VERSION,
    ok: true,
    operation: 'capabilities.list',
    status: 'succeeded',
    context: null,
    data: buildCapabilityCatalog(),
    warnings: [],
    evidence: [],
    recovery: null,
    error: null,
  }
}

function failureEnvelope(): OperationEnvelope {
  return {
    ...successEnvelope(),
    ok: false,
    status: 'failed',
    context: null,
    data: null,
    error: { code: 'INVALID_AGENT_OUTPUT_OPTIONS', message: 'Agent output options are invalid.' },
  }
}

function clone(value: OperationEnvelope): Record<string, unknown> {
  return structuredClone(value) as unknown as Record<string, unknown>
}

function envelopeWithSerializedSize(target: number): OperationEnvelope {
  const envelope = successEnvelope() as {
    warnings: Array<{ code: string; message: string }>
  } & OperationEnvelope
  envelope.warnings = Array.from({ length: 128 }, (_, index) => ({
    code: `WARNING_${index}`,
    message: 'x',
  }))

  let remaining = target - (JSON.stringify(envelope).length + 1)
  if (remaining < 0 || remaining > envelope.warnings.length * 1_999) {
    throw new Error(`cannot construct ${target}-byte envelope`)
  }
  for (const warning of envelope.warnings) {
    const extra = Math.min(remaining, 1_999)
    warning.message += 'x'.repeat(extra)
    remaining -= extra
  }
  if (remaining !== 0) throw new Error(`failed to construct ${target}-byte envelope`)
  return envelope
}

describe('Operation Envelope v1', () => {
  test('accepts the ten-key success shape and serializes deterministically', () => {
    const envelope = successEnvelope()
    const parsed = parseOperationEnvelope(envelope)
    expect(parsed).toEqual({ ok: true, value: envelope })

    const first = serializeOperationEnvelope(envelope)
    const second = serializeOperationEnvelope(structuredClone(envelope))
    expect(first).toEqual(second)
    expect(first.output.endsWith('\n')).toBe(true)
    expect(first.output.endsWith('\n\n')).toBe(false)
    expect(first.output).toBe(
      `${JSON.stringify({
        schemaVersion: 1,
        ok: true,
        operation: 'capabilities.check',
        status: 'succeeded',
        context: envelope.context,
        data: envelope.data,
        warnings: [],
        evidence: [],
        recovery: null,
        error: null,
      })}\n`
    )
  })

  test('rejects unknown fields, unknown operations, and every other schema version', () => {
    for (const value of [
      { ...clone(successEnvelope()), extra: true },
      { ...clone(successEnvelope()), schemaVersion: 2 },
      { ...clone(successEnvelope()), operation: 'query.read' },
      {
        ...clone(successEnvelope()),
        context: { ...successEnvelope().context, password: 'secret' },
      },
      {
        ...clone(successEnvelope()),
        data: { ...successEnvelope().data, rows: [] },
      },
    ]) {
      expect(parseOperationEnvelope(value).ok).toBe(false)
    }
  })

  test('accepts only a bounded correlation ID in context', () => {
    const valid = {
      ...clone(successEnvelope()),
      context: { ...successEnvelope().context, correlationId: 'INC-2026.09.05' },
    }
    expect(parseOperationEnvelope(valid).ok).toBe(true)

    for (const correlationId of [
      '../../PLAT006_PATH',
      'postgresql://plat006:PLAT006_SECRET@db.internal:5432/prod',
      "SELECT * FROM users WHERE email='plat006@example.com'",
      'x'.repeat(161),
    ]) {
      expect(
        parseOperationEnvelope({
          ...clone(successEnvelope()),
          context: { ...successEnvelope().context, correlationId },
        }).ok
      ).toBe(false)
    }
  })

  test('enforces transport, error, and completed-negative-result invariants', () => {
    const unmet: OperationEnvelope = {
      ...successEnvelope(),
      ok: false,
      status: 'failed',
      data: {
        required: ['data.delete'],
        results: [{ id: 'data.delete', status: 'unavailable', reason: 'permission' }],
      },
      error: {
        code: 'CAPABILITY_REQUIREMENTS_UNMET',
        message: 'One or more required capabilities are unavailable.',
      },
    }
    expect(parseOperationEnvelope(unmet).ok).toBe(true)

    for (const value of [
      { ...clone(successEnvelope()), ok: false },
      { ...clone(successEnvelope()), status: 'failed' },
      { ...clone(successEnvelope()), error: { code: 'FAILED', message: 'no' } },
      { ...clone(failureEnvelope()), error: null },
      { ...clone(failureEnvelope()), data: successEnvelope().data },
      { ...clone(unmet), data: null },
      {
        ...clone(successEnvelope()),
        data: {
          required: ['data.delete'],
          results: [{ id: 'data.delete', status: 'unavailable', reason: 'permission' }],
        },
      },
      { ...clone(unmet), data: successEnvelope().data },
    ]) {
      expect(parseOperationEnvelope(value).ok).toBe(false)
    }
  })

  test('enforces strict context and capability-result vocabularies', () => {
    for (const value of [
      { ...clone(successEnvelope()), context: { ...successEnvelope().context, engine: 'oracle' } },
      {
        ...clone(successEnvelope()),
        context: { ...successEnvelope().context, permission: 'root' },
      },
      {
        ...clone(successEnvelope()),
        data: {
          required: ['schema.read'],
          results: [{ id: 'schema.read', status: 'available', reason: 'permission' }],
        },
      },
      {
        ...clone(failureEnvelope()),
        data: {
          required: ['schema.read'],
          results: [{ id: 'schema.read', status: 'unavailable', reason: 'unknown-capability' }],
        },
        error: {
          code: 'CAPABILITY_REQUIREMENTS_UNMET',
          message: 'One or more required capabilities are unavailable.',
        },
      },
      {
        ...clone(successEnvelope()),
        data: {
          required: ['schema.read'],
          results: [{ id: 'other.read', status: 'available', reason: null }],
        },
      },
      {
        ...clone(successEnvelope()),
        data: {
          required: ['SELECT * FROM users'],
          results: [{ id: 'SELECT * FROM users', status: 'available', reason: null }],
        },
      },
      {
        ...clone(successEnvelope()),
        data: {
          required: ['/tmp/secret'],
          results: [{ id: '/tmp/secret', status: 'available', reason: null }],
        },
      },
    ]) {
      expect(parseOperationEnvelope(value).ok).toBe(false)
    }
  })

  test('enforces exact collection, identifier, and message boundaries', () => {
    const ids = Array.from({ length: 128 }, (_, index) => `capability.x${index}`)
    const atCollectionLimit: OperationEnvelope = {
      ...successEnvelope(),
      data: {
        required: ids,
        results: ids.map((id) => ({ id, status: 'available' as const, reason: null })),
      },
      warnings: Array.from({ length: 128 }, () => ({ code: 'A', message: 'x' })),
      evidence: Array.from({ length: 16 }, (_, index) => ({ kind: 'receipt', id: `id-${index}` })),
      error: null,
    }
    expect(parseOperationEnvelope(atCollectionLimit).ok).toBe(true)

    const tooManyIds = [...ids, 'capability.x128']
    expect(
      parseOperationEnvelope({
        ...atCollectionLimit,
        data: {
          required: tooManyIds,
          results: tooManyIds.map((id) => ({ id, status: 'available', reason: null })),
        },
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...atCollectionLimit,
        warnings: [...atCollectionLimit.warnings, { code: 'A', message: 'x' }],
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...atCollectionLimit,
        evidence: [...atCollectionLimit.evidence, { kind: 'audit', id: 'overflow' }],
      }).ok
    ).toBe(false)

    expect(
      parseOperationEnvelope({
        ...failureEnvelope(),
        error: { code: 'A'.repeat(160), message: 'x'.repeat(2_000) },
      }).ok
    ).toBe(true)
    expect(
      parseOperationEnvelope({
        ...failureEnvelope(),
        error: { code: 'A'.repeat(161), message: 'x' },
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...failureEnvelope(),
        error: { code: 'BAD-CODE', message: 'x' },
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...failureEnvelope(),
        error: { code: 'FAILED', message: 'x'.repeat(2_001) },
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...successEnvelope(),
        context: { ...successEnvelope().context, connectionName: 'x'.repeat(160) },
      }).ok
    ).toBe(true)
    expect(
      parseOperationEnvelope({
        ...successEnvelope(),
        context: { ...successEnvelope().context, connectionName: 'x'.repeat(161) },
      }).ok
    ).toBe(false)
  })

  test('accepts only bounded path-free evidence references', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    for (const kind of ['receipt', 'audit', 'verification-artifact'] as const) {
      expect(
        parseOperationEnvelope({
          ...successEnvelope(),
          evidence: [{ kind, id: 'A'.repeat(160), digest }],
        }).ok
      ).toBe(true)
    }

    for (const evidence of [
      { kind: 'file', id: 'id' },
      { kind: 'receipt', id: 'A'.repeat(161) },
      { kind: 'receipt', id: '../secret' },
      { kind: 'receipt', id: 'id', digest: 'sha256:ABC' },
      { kind: 'receipt', id: 'id', path: '/tmp/receipt.json' },
      { kind: 'receipt', id: 'id', body: { secret: true } },
    ]) {
      expect(parseOperationEnvelope({ ...successEnvelope(), evidence: [evidence] }).ok).toBe(false)
    }
  })

  test('reuses the strict Recovery Envelope and requires matching bounded errors', () => {
    const recovery: RecoveryEnvelope = {
      schemaVersion: 1,
      generatedAt: '2026-09-04T00:00:00.000Z',
      ok: false,
      error: { code: 'CONFIG_MISSING', category: 'config', message: 'No config.' },
      recovery: [],
    }
    const envelope: OperationEnvelope = {
      ...failureEnvelope(),
      recovery,
      error: { code: 'CONFIG_MISSING', message: 'No config.' },
    }
    expect(parseOperationEnvelope(envelope).ok).toBe(true)
    expect(
      parseOperationEnvelope({
        ...envelope,
        error: { code: 'CONFIG_MISSING', message: 'Different.' },
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...envelope,
        recovery: { ...recovery, unexpected: true },
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...envelope,
        recovery: {
          ...recovery,
          recovery: [
            {
              order: 1,
              command: 'x'.repeat(2_001),
              rationale: 'r',
              risk: 'readonly',
              expects: 'e',
            },
          ],
        },
      }).ok
    ).toBe(false)

    const steps = Array.from({ length: 6 }, (_, index) => ({
      order: index + 1,
      command: `dbcli step-${index + 1}`,
      rationale: 'r',
      risk: 'readonly' as const,
      expects: 'e',
    }))
    expect(
      parseOperationEnvelope({
        ...envelope,
        recovery: { ...recovery, recovery: steps },
      }).ok
    ).toBe(true)
    expect(
      parseOperationEnvelope({
        ...envelope,
        recovery: {
          ...recovery,
          recovery: [
            ...steps,
            { order: 7, command: 'dbcli step-7', rationale: 'r', risk: 'readonly', expects: 'e' },
          ],
        },
      }).ok
    ).toBe(true)
  })

  test('allows exactly 65,536 UTF-8 bytes and replaces the next byte with a safe failure', () => {
    const exact = envelopeWithSerializedSize(MAX_OPERATION_ENVELOPE_BYTES)
    expect(parseOperationEnvelope(exact).ok).toBe(true)
    const exactSerialized = serializeOperationEnvelope(exact)
    expect(new TextEncoder().encode(exactSerialized.output)).toHaveLength(
      MAX_OPERATION_ENVELOPE_BYTES
    )
    expect(exactSerialized.exceededLimit).toBe(false)

    const oversized = envelopeWithSerializedSize(MAX_OPERATION_ENVELOPE_BYTES + 1)
    expect(parseOperationEnvelope(oversized).ok).toBe(false)
    const fallback = serializeOperationEnvelope(oversized)
    expect(fallback.exceededLimit).toBe(true)
    expect(fallback.envelope.error?.code).toBe('AGENT_OUTPUT_LIMIT_EXCEEDED')
    expect(parseOperationEnvelope(JSON.parse(fallback.output)).ok).toBe(true)

    const catalog = buildCapabilityCatalog()
    const oversizedList: OperationEnvelope = {
      ...catalogSuccessEnvelope(),
      data: {
        ...catalog,
        capabilities: Array.from({ length: 256 }, () => catalog.capabilities[0]!),
      },
    }
    const listFallback = serializeOperationEnvelope(oversizedList)
    expect(listFallback.envelope.operation).toBe('capabilities.list')
    expect(parseOperationEnvelope(JSON.parse(listFallback.output)).ok).toBe(true)
  })

  test('accepts capabilities.list success envelope, strictly validates catalog data, and stays well under 64 KiB', () => {
    const envelope = catalogSuccessEnvelope()
    const parsed = parseOperationEnvelope(envelope)
    expect(parsed).toEqual({ ok: true, value: envelope })

    const serialized = serializeOperationEnvelope(envelope)
    expect(serialized.exceededLimit).toBe(false)
    expect(serialized.output.endsWith('\n')).toBe(true)
    expect(new TextEncoder().encode(serialized.output).byteLength).toBeLessThan(
      MAX_OPERATION_ENVELOPE_BYTES
    )

    // Invariants for capabilities.list
    expect(parseOperationEnvelope({ ...clone(envelope), ok: false }).ok).toBe(false)
    expect(parseOperationEnvelope({ ...clone(envelope), status: 'failed' }).ok).toBe(false)
    expect(
      parseOperationEnvelope({ ...clone(envelope), error: { code: 'FAIL', message: 'err' } }).ok
    ).toBe(false)
    expect(parseOperationEnvelope({ ...clone(envelope), data: null }).ok).toBe(false)
    expect(parseOperationEnvelope({ ...clone(envelope), data: successEnvelope().data }).ok).toBe(
      false
    )
    expect(
      parseOperationEnvelope({ ...clone(envelope), context: successEnvelope().context }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...clone(envelope),
        warnings: [{ code: 'WARNING', message: 'not static' }],
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...clone(envelope),
        evidence: [{ kind: 'audit', id: 'audit-1' }],
      }).ok
    ).toBe(false)
    expect(
      parseOperationEnvelope({
        ...clone(envelope),
        recovery: {
          id: 'recovery-1',
          error: { code: 'FAIL', message: 'err' },
          recovery: [],
        },
      }).ok
    ).toBe(false)

    const failedList: OperationEnvelope = {
      schemaVersion: 1,
      ok: false,
      operation: 'capabilities.list',
      status: 'failed',
      context: null,
      data: null,
      warnings: [],
      evidence: [],
      recovery: null,
      error: { code: 'UNSUPPORTED_AGENT_OUTPUT_OPERATION', message: 'err' },
    }
    expect(parseOperationEnvelope(failedList).ok).toBe(true)
    // Failed capabilities.list must have data: null
    expect(parseOperationEnvelope({ ...clone(failedList), data: envelope.data }).ok).toBe(false)
  })

  test('rejects every exact structural leak fixture without output or persistence', () => {
    const fixtures = [
      {
        ...clone(successEnvelope()),
        context: { ...successEnvelope().context, password: 'PLAT004_PASSWORD_SENTINEL' },
      },
      {
        ...clone(successEnvelope()),
        context: {
          ...successEnvelope().context,
          connectionString: 'postgresql://plat004:PLAT004_SECRET@db.internal:5432/prod',
        },
      },
      {
        ...clone(successEnvelope()),
        data: { ...successEnvelope().data, rows: [{ ssn: 'PLAT004_ROW_SENTINEL' }] },
      },
      {
        ...clone(successEnvelope()),
        data: {
          ...successEnvelope().data,
          sql: "SELECT * FROM users WHERE email='plat004@example.com'",
        },
      },
      {
        ...clone(successEnvelope()),
        context: {
          ...successEnvelope().context,
          configPath: '/Users/plat004/private/config.json',
        },
      },
      // PLAT-005 security fixture matrix
      {
        ...clone(catalogSuccessEnvelope()),
        data: {
          ...buildCapabilityCatalog(),
          capabilities: [
            {
              ...buildCapabilityCatalog().capabilities[0]!,
              command: 'PLAT005_EXEC_CMD',
            },
          ],
        },
      },
      {
        ...clone(successEnvelope()),
        context: { ...successEnvelope().context, password: 'PLAT005_PASSWORD_SENTINEL' },
      },
      {
        ...clone(successEnvelope()),
        context: {
          ...successEnvelope().context,
          connectionString: 'postgresql://plat005:PLAT005_SECRET@db.internal:5432/prod',
        },
      },
      {
        ...clone(successEnvelope()),
        data: { ...successEnvelope().data, rows: [{ ssn: 'PLAT005_ROW_SENTINEL' }] },
      },
      {
        ...clone(successEnvelope()),
        data: {
          ...successEnvelope().data,
          sql: "SELECT * FROM users WHERE email='plat005@example.com'",
        },
      },
    ]
    for (const fixture of fixtures) expect(parseOperationEnvelope(fixture).ok).toBe(false)
  })
})

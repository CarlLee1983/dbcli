import { describe, test, expect } from 'bun:test'
import {
  quoteIdentifier,
  quoteQualifiedIdentifier,
  encodeEsIndexExpression,
  encodeEsPathSegment,
} from '@/adapters/identifier-quote'

describe('quoteIdentifier', () => {
  test('PostgreSQL 以雙引號包裹，內含雙引號重複跳脫', () => {
    expect(quoteIdentifier('users', 'postgresql')).toBe('"users"')
    expect(quoteIdentifier('we"ird', 'postgresql')).toBe('"we""ird"')
  })

  test('MySQL/MariaDB 以反引號包裹，內含反引號重複跳脫', () => {
    expect(quoteIdentifier('users', 'mysql')).toBe('`users`')
    expect(quoteIdentifier('we`ird', 'mysql')).toBe('`we``ird`')
    expect(quoteIdentifier('we`ird', 'mariadb')).toBe('`we``ird`')
  })

  test('反引號在 PostgreSQL、雙引號在 MySQL 都只是普通字元', () => {
    expect(quoteIdentifier('back`tick', 'postgresql')).toBe('"back`tick"')
    expect(quoteIdentifier('do"uble', 'mysql')).toBe('`do"uble`')
  })

  test('點不被當成分隔字元，整段視為單一識別字', () => {
    expect(quoteIdentifier('a.b', 'postgresql')).toBe('"a.b"')
    expect(quoteIdentifier('a.b', 'mysql')).toBe('`a.b`')
  })

  test('空白仍是合法識別字，只是需要 quote', () => {
    expect(quoteIdentifier('a b', 'mysql')).toBe('`a b`')
  })

  test('空字串與含 NUL 的識別字被拒絕', () => {
    expect(() => quoteIdentifier('', 'mysql')).toThrow()
    expect(() => quoteIdentifier('a\u0000b', 'mysql')).toThrow()
  })
})

describe('quoteQualifiedIdentifier', () => {
  test('逐段 quote 並以點串接', () => {
    expect(quoteQualifiedIdentifier('public.users', 'postgresql')).toBe('"public"."users"')
    expect(quoteQualifiedIdentifier('app.orders', 'mysql')).toBe('`app`.`orders`')
  })

  test('每一段各自跳脫', () => {
    expect(quoteQualifiedIdentifier('we"ird.ta"ble', 'postgresql')).toBe('"we""ird"."ta""ble"')
  })

  test('單段輸入等同 quoteIdentifier', () => {
    expect(quoteQualifiedIdentifier('users', 'postgresql')).toBe(
      quoteIdentifier('users', 'postgresql')
    )
  })
})

describe('encodeEsPathSegment', () => {
  test('斜線被編碼，不會多切出一層路徑', () => {
    expect(encodeEsPathSegment('secrets/_search')).toBe('secrets%2F_search')
  })

  test('純粹的 . 與 .. 被編碼，不會被 URL 正規化成上一層', () => {
    expect(encodeEsPathSegment('..')).toBe('%2E%2E')
    expect(encodeEsPathSegment('.')).toBe('%2E')
  })

  test('query string 與 fragment 分隔字元被編碼', () => {
    expect(encodeEsPathSegment('id?refresh=true')).toBe('id%3Frefresh%3Dtrue')
    expect(encodeEsPathSegment('id#frag')).toBe('id%23frag')
  })

  test('已含百分比的字面值被再次編碼，不會被伺服器二次解碼', () => {
    expect(encodeEsPathSegment('a%2Fb')).toBe('a%252Fb')
  })

  test('一般名稱維持原樣', () => {
    expect(encodeEsPathSegment('my-index-000001')).toBe('my-index-000001')
  })

  test('空字串被拒絕', () => {
    expect(() => encodeEsPathSegment('')).toThrow()
  })
})

describe('encodeEsIndexExpression', () => {
  test('逗號分隔的多 index 語法被保留，各段分別編碼', () => {
    expect(encodeEsIndexExpression('logs-a,logs-b')).toBe('logs-a,logs-b')
    expect(encodeEsIndexExpression('logs/a,logs-b')).toBe('logs%2Fa,logs-b')
  })

  test('萬用字元 * 與 _all 維持原樣', () => {
    expect(encodeEsIndexExpression('logs-*')).toBe('logs-*')
    expect(encodeEsIndexExpression('_all')).toBe('_all')
  })

  test('路徑穿越被擋在單一段內', () => {
    expect(encodeEsIndexExpression('../_cat/indices')).toBe('..%2F_cat%2Findices')
  })

  test('remote cluster 限定字與排除前綴編碼後仍可還原', () => {
    expect(decodeURIComponent(encodeEsIndexExpression('cluster:logs'))).toBe('cluster:logs')
    expect(decodeURIComponent(encodeEsIndexExpression('-logs-2024'))).toBe('-logs-2024')
  })

  test('date math 表示式編碼後仍可還原', () => {
    expect(decodeURIComponent(encodeEsIndexExpression('<logs-{now/d}>'))).toBe('<logs-{now/d}>')
  })

  test('空的 index 表示式被拒絕', () => {
    expect(() => encodeEsIndexExpression('')).toThrow()
  })
})

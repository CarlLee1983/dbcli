/**
 * 識別字的 quote 與編碼——單一實作來源。
 *
 * 這裡的規則原本散在四處：PostgreSQL adapter 有正確的雙引號跳脫，兩套 DDL
 * 產生器各自用不跳脫的 `q()`，MySQL 的 metadata 查詢直接把表名內插進反引號。
 * 只要表名帶了一個反引號或雙引號，後三者產出的就是語法錯誤、或更糟——指到
 * 另一個物件的 SQL。規則放同一個檔案，是為了讓「修好一處、漏掉三處」這件事
 * 不再可能發生。
 *
 * Elasticsearch 沒有 quote，只有 URL 路徑；index 與 document id 是使用者輸入
 * 而 API 路徑是結構，兩者必須靠 percent-encoding 分開。
 */

export type SqlIdentifierDialect = 'postgresql' | 'mysql' | 'mariadb'

/** 各方言的識別字引號字元 */
function quoteCharFor(dialect: SqlIdentifierDialect): string {
  return dialect === 'postgresql' ? '"' : '`'
}

function assertQuotable(name: string, what: string): void {
  if (name.length === 0) {
    throw new Error(`${what} must not be empty`)
  }
  // NUL 無法被任何 quote 規則跳脫，兩個引擎都不接受。
  if (name.includes(String.fromCharCode(0))) {
    throw new Error(`${what} must not contain a NUL character`)
  }
}

/**
 * quote 單一識別字。點被視為名稱的一部分而非分隔字元——`quoteIdentifier('a.b')`
 * 產生一個叫 `a.b` 的物件，不是 schema `a` 的 table `b`。要後者用
 * {@link quoteQualifiedIdentifier}。
 */
export function quoteIdentifier(name: string, dialect: SqlIdentifierDialect): string {
  assertQuotable(name, 'identifier')
  const q = quoteCharFor(dialect)
  return `${q}${name.split(q).join(q + q)}${q}`
}

/** quote 以點分隔的合格名稱（`schema.table`），逐段各自跳脫。 */
export function quoteQualifiedIdentifier(name: string, dialect: SqlIdentifierDialect): string {
  assertQuotable(name, 'qualified identifier')
  return name
    .split('.')
    .map((segment) => quoteIdentifier(segment.trim(), dialect))
    .join('.')
}

/**
 * percent-encode 一段 URL 路徑。
 *
 * `encodeURIComponent` 之外多做一件事：整段就是 `.` 或 `..` 時連點一起編碼。
 * URL 正規化發生在 percent-decoding 之前，所以 `%2E%2E` 是一個名字，`..` 是
 * 往上一層——一個名為 `..` 的 index 不該讓請求打到 cluster 根目錄。
 */
export function encodeEsPathSegment(value: string): string {
  if (value.length === 0) {
    throw new Error('Elasticsearch path segment must not be empty')
  }
  if (value === '.' || value === '..') {
    return value.replaceAll('.', '%2E')
  }
  return encodeURIComponent(value)
}

/**
 * percent-encode 一個 index 表示式。
 *
 * `--index` 收的是表示式而非名稱：逗號列表、`*` / `?` 萬用字元、`_all`、
 * 排除前綴、`cluster:index` 與 date math 都合法（見 `utils/es-index-target.ts`）。
 * 逗號是 Elasticsearch 的語法，必須留在路徑裡；其餘每一段照 URL 元件編碼，
 * 由伺服器解碼回原本的字元。這與官方 client 對陣列 index 的處理一致。
 */
export function encodeEsIndexExpression(expression: string): string {
  if (expression.length === 0) {
    throw new Error('Elasticsearch index expression must not be empty')
  }
  return expression
    .split(',')
    .map((part) => encodeEsPathSegment(part))
    .join(',')
}

# CSV output serializes JSON and date cells instead of printing `[object Object]`

## Goal

An agent that runs `dbcli query … --format csv` (or `q … --format csv`) against
a MySQL/MariaDB table with a JSON column or a DATETIME/TIMESTAMP column gets
usable cells on the first try. Today the CSV path in
`src/formatters/query-result-formatter.ts:230-245` (`escapeCSVField`) calls
`String(value)`, so a JSON column decoded by the driver prints
`[object Object]` and a `Date` prints the local-time string
`Wed Oct 07 2026 15:32:40 GMT+0800 (Taiwan Standard Time)`. Agents then re-run
the same query with `--format json`, paying for the query twice.

After the change, a CSV cell holding a plain object or array is written as
its `JSON.stringify` text (then CSV-escaped as today), and a cell holding a
`Date` is written as its ISO 8601 UTC string (`toISOString()`), the same text
`--format json` already shows for that cell. Strings, numbers, booleans,
`null`/`undefined`, and the CSV escaping rules are unchanged.

## Out of Scope

- `export --format csv` (`src/commands/export.ts:534-545`), which already
  stringifies objects; its `Date` handling is not changed here.
- Table and HTML output, and the `--truncate` behaviour.
- Timezone configuration or locale-aware date formatting.

## Acceptance Criteria

1. A unit test formats a row containing `{ a: 1 }`, `[1, 2]`, and
   `new Date('2026-10-07T07:32:40.000Z')` as CSV and asserts the cells are
   `"{""a"":1}"`, `"[1,2]"`, and `2026-10-07T07:32:40.000Z`.
2. Existing CSV formatter tests pass unchanged.
3. `make verify` passes.

import type { ContextPayload } from './context'

export function serializeJson(payload: ContextPayload): string {
  return JSON.stringify(payload, null, 2)
}

export function serializeXml(payload: ContextPayload): string {
  const parts: string[] = []

  parts.push(
    `<database_context system="${escapeXml(payload.system)}" permission="${escapeXml(payload.permission)}" version="${escapeXml(payload.version)}">`
  )

  // 1. Blacklist Policy
  if (payload.blacklist.tables.length > 0 || Object.keys(payload.blacklist.columns).length > 0) {
    parts.push('  <blacklist_policy>')
    for (const t of payload.blacklist.tables) {
      parts.push(`    <table name="${escapeXml(t)}" />`)
    }
    for (const [table, cols] of Object.entries(payload.blacklist.columns)) {
      for (const col of cols) {
        parts.push(`    <column table="${escapeXml(table)}" name="${escapeXml(col)}" />`)
      }
    }
    parts.push('  </blacklist_policy>')
  }

  // 2. Tables Schema
  if (Object.keys(payload.schema).length > 0) {
    parts.push('  <tables>')
    for (const [tableName, table] of Object.entries(payload.schema)) {
      const rowsAttr = table.rowCount !== undefined ? ` rows="${table.rowCount}"` : ''
      const pkAttr = table.primaryKey ? ` primary_key="${table.primaryKey.join(',')}"` : ''
      parts.push(`    <table name="${escapeXml(tableName)}"${rowsAttr}${pkAttr}>`)

      for (const col of table.columns) {
        const pk = col.primaryKey ? ' primary_key="true"' : ''
        const nulls = col.nullable ? ' nullable="true"' : ' nullable="false"'
        const def = col.default !== undefined ? ` default="${escapeXml(col.default)}"` : ''
        const ref = col.foreignKey
          ? ` references="${escapeXml(col.foreignKey.table)}.${escapeXml(col.foreignKey.column)}"`
          : ''
        parts.push(
          `      <column name="${escapeXml(col.name)}" type="${escapeXml(col.type)}"${pk}${nulls}${def}${ref} />`
        )
      }

      parts.push('    </table>')
    }
    parts.push('  </tables>')
  }

  // 3. Saved Queries
  if (payload.snippets.length > 0) {
    parts.push('  <saved_queries>')
    for (const snip of payload.snippets) {
      const engAttr = snip.engines ? ` engines="${snip.engines.map(escapeXml).join(',')}"` : ''
      parts.push(`    <query name="${escapeXml(snip.key)}"${engAttr}>`)
      if (snip.description) {
        parts.push(`      <description>${escapeXml(snip.description)}</description>`)
      }
      for (const p of snip.params) {
        const req = p.required ? ' required="true"' : ''
        const def = p.default !== undefined ? ` default="${escapeXml(String(p.default))}"` : ''
        parts.push(
          `      <param name="${escapeXml(p.name)}" type="${escapeXml(p.type)}"${req}${def} />`
        )
      }
      parts.push('    </query>')
    }
    parts.push('  </saved_queries>')
  }

  parts.push('</database_context>')
  return parts.join('\n')
}

export function serializeMarkdown(payload: ContextPayload): string {
  const parts: string[] = []

  parts.push(`# Database Context Summary`)
  parts.push(``)
  parts.push(`- **Engine System:** \`${payload.system}\``)
  parts.push(`- **Permission Tier:** \`${payload.permission}\``)
  parts.push(`- **Config Version:** \`${payload.version}\``)
  parts.push(``)

  // Blacklist
  if (payload.blacklist.tables.length > 0 || Object.keys(payload.blacklist.columns).length > 0) {
    parts.push(`## Blacklist Policies`)
    parts.push(``)
    if (payload.blacklist.tables.length > 0) {
      parts.push(`### Blacklisted Tables`)
      for (const t of payload.blacklist.tables) {
        parts.push(`- \`${t}\``)
      }
      parts.push(``)
    }
    if (Object.keys(payload.blacklist.columns).length > 0) {
      parts.push(`### Blacklisted Columns`)
      for (const [table, cols] of Object.entries(payload.blacklist.columns)) {
        parts.push(`- **Table \`${table}\`:** ${cols.map((c) => `\`${c}\``).join(', ')}`)
      }
      parts.push(``)
    }
  }

  // Schema
  parts.push(`## Tables & Columns Schema`)
  parts.push(``)
  if (Object.keys(payload.schema).length === 0) {
    parts.push(`*No table schemas cached or active.*`)
    parts.push(``)
  } else {
    for (const [tableName, table] of Object.entries(payload.schema)) {
      const rows = table.rowCount !== undefined ? ` (~${table.rowCount.toLocaleString()} rows)` : ''
      parts.push(`### \`${tableName}\`${rows}`)
      parts.push(``)
      parts.push(`| Column | Type | Nullable | Primary Key | Default | References |`)
      parts.push(`| :--- | :--- | :---: | :---: | :--- | :--- |`)
      for (const col of table.columns) {
        const pk = col.primaryKey ? '✅' : '-'
        const nulls = col.nullable ? 'Yes' : 'No'
        const def = col.default !== undefined ? `\`${col.default}\`` : '-'
        const ref = col.foreignKey ? `\`${col.foreignKey.table}.${col.foreignKey.column}\`` : '-'
        parts.push(`| \`${col.name}\` | \`${col.type}\` | ${nulls} | ${pk} | ${def} | ${ref} |`)
      }
      parts.push(``)
    }
  }

  // Snippets
  if (payload.snippets.length > 0) {
    parts.push(`## Available Saved Queries`)
    parts.push(``)
    for (const snip of payload.snippets) {
      parts.push(`### \`${snip.key}\``)
      if (snip.description) {
        parts.push(`*${snip.description}*`)
      }
      if (snip.engines && snip.engines.length > 0) {
        parts.push(`- **Engines:** ${snip.engines.map((e) => `\`${e}\``).join(', ')}`)
      }
      if (snip.params.length > 0) {
        parts.push(`- **Parameters:**`)
        for (const p of snip.params) {
          const req = p.required ? ' (required)' : ''
          const def = p.default !== undefined ? ` (default: \`${p.default}\`)` : ''
          parts.push(`  - \`${p.name}\` (\`${p.type}\`)${req}${def}`)
        }
      }
      parts.push(``)
    }
  }

  return parts.join('\n')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

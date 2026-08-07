import type { DesignReviewReport, DesignSpec } from '@/core/design'

export type DesignFormat = 'json' | 'markdown' | 'mermaid'

export function formatDesign(spec: DesignSpec, review: DesignReviewReport, format: DesignFormat): string {
  if (format === 'json') return JSON.stringify({ spec, review }, null, 2)
  if (format === 'mermaid') return formatMermaid(spec)
  return formatMarkdown(spec, review)
}

export function formatDesignReview(review: DesignReviewReport, format: Exclude<DesignFormat, 'mermaid'>): string {
  if (format === 'json') return JSON.stringify(review, null, 2)
  const lines = ['# Design review', '']
  if (review.findings.length === 0) lines.push('No design findings.')
  else {
    lines.push('| Severity | Code | Location | Finding |', '| --- | --- | --- | --- |')
    for (const finding of review.findings) {
      lines.push(
        `| ${finding.severity} | ${finding.code} | ${escapeTable(finding.path)} | ${escapeTable(finding.message)} |`
      )
    }
  }
  lines.push('', `Summary: ${review.summary.errors} error(s), ${review.summary.warns} warning(s), ${review.summary.infos} info(s).`)
  return lines.join('\n')
}

function formatMarkdown(spec: DesignSpec, review: DesignReviewReport): string {
  const lines = ['# Database Design', '', `Dialect: \`${spec.dialect}\``, '']
  for (const model of spec.models) {
    lines.push(`## ${model.name}`, '', `Physical table: \`${model.table}\``)
    if (model.description) lines.push('', escapeText(model.description))
    lines.push('', '| Field | Type | Nullable | Key |', '| --- | --- | --- | --- |')
    for (const field of model.fields) {
      const key = field.primaryKey ? 'primary' : field.unique ? 'unique' : ''
      lines.push(`| \`${field.name}\` | \`${field.type}\` | ${field.nullable ? 'yes' : 'no'} | ${key} |`)
    }
    if (model.indexes.length > 0) {
      lines.push('', 'Indexes:')
      for (const index of model.indexes) {
        lines.push(`- ${index.unique ? 'unique ' : ''}index on \`${index.columns.join(', ')}\``)
      }
    }
    lines.push('')
  }
  if (spec.relationships.length > 0) {
    lines.push('## Relationships', '')
    for (const relationship of spec.relationships) {
      lines.push(`- \`${relationship.name}\`: \`${relationship.from.model}.${relationship.from.field}\` → \`${relationship.to.model}.${relationship.to.field}\` (${relationship.cardinality})`)
    }
    lines.push('')
  }
  if (spec.accessPatterns.length > 0) {
    lines.push('## Access patterns', '')
    for (const pattern of spec.accessPatterns) {
      lines.push(`- \`${pattern.model}\`: filter ${inlineList(pattern.filters)}; sort ${inlineList(pattern.sort)}`)
    }
    lines.push('')
  }
  if (spec.decisions.length > 0) {
    lines.push('## Decisions', '')
    for (const decision of spec.decisions) lines.push(`- **${decision.name}** — ${escapeText(decision.rationale)}`)
    lines.push('')
  }
  lines.push(formatDesignReview(review, 'markdown'))
  return lines.join('\n')
}

function formatMermaid(spec: DesignSpec): string {
  const lines = ['erDiagram']
  for (const model of spec.models) {
    lines.push(`  ${model.table} {`)
    for (const field of model.fields) {
      const markers = [field.primaryKey ? 'PK' : '', field.unique && !field.primaryKey ? 'UK' : ''].filter(Boolean).join(', ')
      lines.push(`    ${mermaidType(field.type)} ${field.name}${markers ? ` "${markers}"` : ''}`)
    }
    lines.push('  }')
  }
  const models = new Map(spec.models.map((model) => [model.name, model]))
  for (const relationship of spec.relationships) {
    const from = models.get(relationship.from.model)
    const to = models.get(relationship.to.model)
    if (!from || !to) continue
    lines.push(`  ${from.table} ${mermaidCardinality(relationship.cardinality)} ${to.table} : "${relationship.name}"`)
  }
  return lines.join('\n')
}

function mermaidCardinality(cardinality: string): string {
  if (cardinality === 'one-to-one') return '||--||'
  if (cardinality === 'one-to-many') return '||--o{'
  if (cardinality === 'many-to-one') return '}o--||'
  return '}o--o{'
}

function mermaidType(type: string): string {
  return type.replace(/[^A-Za-z0-9_]/g, '_')
}

function inlineList(values: string[]): string {
  return values.length === 0 ? 'none' : values.map((value) => `\`${value}\``).join(', ')
}

function escapeTable(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>')
}

function escapeText(value: string): string {
  return value.replace(/([`*_{}[\]()#+.!|>~-])/g, '\\$1').replace(/\r\n|\r|\n/g, '<br>')
}

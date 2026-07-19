/**
 * Hand-written schema.prisma parser for the deliberately narrow ORM-drift subset.
 * Unsupported or malformed schema syntax is reported instead of inferred.
 */
import type {
  NormalizedColumn,
  NormalizedSchema,
  NormalizedTable,
  UnparsedEntry,
} from '@/core/orm-drift/normalized-schema'

const SCALAR_TYPES: Record<string, string> = {
  String: 'text',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'double precision',
  Decimal: 'decimal',
  Boolean: 'boolean',
  DateTime: 'timestamp',
  Json: 'json',
  Bytes: 'bytea',
}

type NativeArgumentRule = 'none' | 'positive-integer' | 'optional-nonnegative-integer'

interface NativeTypeRule {
  type: string
  prismaScalar: string
  arguments: NativeArgumentRule
}

const NATIVE_TYPES: Record<string, NativeTypeRule> = {
  Text: { type: 'text', prismaScalar: 'String', arguments: 'none' },
  VarChar: { type: 'varchar', prismaScalar: 'String', arguments: 'positive-integer' },
  Uuid: { type: 'uuid', prismaScalar: 'String', arguments: 'none' },
  Timestamptz: {
    type: 'timestamp with time zone',
    prismaScalar: 'DateTime',
    arguments: 'optional-nonnegative-integer',
  },
  Date: { type: 'date', prismaScalar: 'DateTime', arguments: 'none' },
  SmallInt: { type: 'smallint', prismaScalar: 'Int', arguments: 'none' },
  JsonB: { type: 'jsonb', prismaScalar: 'Json', arguments: 'none' },
}

interface SchemaBlock {
  kind: string
  name: string
  lines: Array<{ text: string; number: number }>
  startLine: number
}

interface ParsedAttribute {
  name: string
  args?: string
}

interface RawField {
  name: string
  type: string
  optional: boolean
  isList: boolean
  attributes: ParsedAttribute[]
}

interface PendingIndex {
  location: string
  fields: string[]
  unique: boolean
}

interface PendingRelation {
  location: string
  localFields: string[]
  refModel: string
  refFields: string[]
}

interface ModelInfo {
  name: string
  tableName: string
  fields: RawField[]
  pendingIndexes: PendingIndex[]
  pendingRelations: PendingRelation[]
  columnNames: Map<string, string>
  table: NormalizedTable
}

interface AttributeParseResult {
  attributes?: ParsedAttribute[]
  error?: string
}

export function parsePrismaSchema(text: string): NormalizedSchema {
  const unparsed: UnparsedEntry[] = []
  const blocks = collectBlocks(text, unparsed)
  const modelBlocks: SchemaBlock[] = []

  for (const block of blocks) {
    if (block.kind === 'model') {
      modelBlocks.push(block)
      continue
    }
    if (block.kind === 'datasource') {
      if (block.lines.some((line) => /^\s*schemas\s*=/.test(stripLineComment(line.text)))) {
        addBlocked(unparsed, `datasource ${block.name}`, 'multi-schema datasource configuration')
      }
      continue
    }
    if (block.kind === 'generator') continue
    addBlocked(
      unparsed,
      `${block.kind} ${block.name}`,
      `unsupported top-level block '${block.kind}'`
    )
  }

  const duplicateModels = findDuplicates(modelBlocks.map((block) => block.name))
  const uniqueModelBlocks = modelBlocks.filter((block) => {
    if (!duplicateModels.has(block.name)) return true
    addBlocked(unparsed, `model ${block.name}`, `duplicate model '${block.name}'`)
    return false
  })
  const modelNames = new Set(uniqueModelBlocks.map((block) => block.name))
  const models = uniqueModelBlocks.map((block) => parseModel(block, unparsed))
  const modelByName = new Map(models.map((model) => [model.name, model]))

  for (const model of models) {
    buildColumns(model, modelNames, unparsed)
  }
  for (const model of models) {
    resolveIndexes(model, unparsed)
    resolveRelations(model, modelByName, unparsed)
  }

  const tables: Record<string, NormalizedTable> = {}
  for (const model of models) {
    const key = model.tableName.toLowerCase()
    if (tables[key]) {
      addBlocked(unparsed, `model ${model.name}`, `duplicate normalized table key '${key}'`)
      continue
    }
    tables[key] = model.table
  }

  return { source: 'prisma', tables, unparsed }
}

function collectBlocks(text: string, unparsed: UnparsedEntry[]): SchemaBlock[] {
  const blocks: SchemaBlock[] = []
  let active: SchemaBlock | undefined
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? ''
    const line = stripLineComment(rawLine).trim()
    const lineNumber = index + 1
    if (!line) continue

    if (active) {
      if (line === '}') {
        blocks.push(active)
        active = undefined
      } else {
        active.lines.push({ text: rawLine, number: lineNumber })
      }
      continue
    }

    const opener = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\{$/)
    if (opener?.[1] && opener[2]) {
      active = {
        kind: opener[1],
        name: opener[2],
        lines: [],
        startLine: lineNumber,
      }
      continue
    }

    if (line === '}') {
      addBlocked(unparsed, `line ${lineNumber}`, 'unmatched closing brace')
    } else {
      addBlocked(unparsed, `line ${lineNumber}`, `malformed top-level construct '${line}'`)
    }
  }

  if (active) {
    addBlocked(
      unparsed,
      `line ${active.startLine}`,
      `unmatched opening brace for ${active.kind} ${active.name}`
    )
  }
  return blocks
}

function parseModel(block: SchemaBlock, unparsed: UnparsedEntry[]): ModelInfo {
  const fields: RawField[] = []
  const pendingIndexes: PendingIndex[] = []
  let tableName = block.name
  let hasTableMap = false

  for (const sourceLine of block.lines) {
    const line = stripLineComment(sourceLine.text).trim()
    if (!line) continue
    if (line.startsWith('@@')) {
      const parsed = parseBlockAttribute(line)
      if (!parsed.attribute) {
        addBlocked(unparsed, `${block.name}:line ${sourceLine.number}`, parsed.error ?? 'malformed')
        continue
      }
      const attribute = parsed.attribute
      if (attribute.name === 'map') {
        const mapped = parseStringArgument(attribute.args)
        if (!mapped || hasTableMap) {
          addBlocked(unparsed, block.name, `malformed or duplicate '@@map' attribute`)
          continue
        }
        tableName = mapped
        hasTableMap = true
        continue
      }
      if (attribute.name === 'index' || attribute.name === 'unique') {
        const indexFields = parseFieldList(attribute.args)
        if (!indexFields) {
          addBlocked(unparsed, block.name, `malformed '@@${attribute.name}' attribute`)
          continue
        }
        pendingIndexes.push({
          location: block.name,
          fields: indexFields,
          unique: attribute.name === 'unique',
        })
        continue
      }
      addBlocked(unparsed, block.name, `unsupported block attribute '@@${attribute.name}'`)
      continue
    }

    const field = parseField(line, block.name, sourceLine.number, unparsed)
    if (field) fields.push(field)
  }

  return {
    name: block.name,
    tableName,
    fields,
    pendingIndexes,
    pendingRelations: [],
    columnNames: new Map(),
    table: { name: tableName, columns: [], indexes: [], foreignKeys: [] },
  }
}

function parseField(
  line: string,
  modelName: string,
  lineNumber: number,
  unparsed: UnparsedEntry[]
): RawField | undefined {
  const match = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?(?:\s+(.*))?$/)
  if (!match?.[1] || !match[2]) {
    addBlocked(unparsed, `${modelName}:line ${lineNumber}`, `malformed field declaration '${line}'`)
    return undefined
  }

  const attributeText = match[5]?.trim() ?? ''
  const parsed = parseAttributes(attributeText)
  if (parsed.error) {
    addBlocked(unparsed, `${modelName}.${match[1]}`, parsed.error)
    return undefined
  }

  const attributes = parsed.attributes ?? []
  const unsupported = attributes.find(
    (attribute) =>
      !['id', 'unique', 'default', 'map', 'relation'].includes(attribute.name) &&
      !attribute.name.startsWith('db.')
  )
  if (unsupported) {
    addBlocked(
      unparsed,
      `${modelName}.${match[1]}`,
      `unsupported field attribute '@${unsupported.name}'`
    )
    return undefined
  }

  return {
    name: match[1],
    type: match[2],
    isList: Boolean(match[3]),
    optional: Boolean(match[4]),
    attributes,
  }
}

function buildColumns(model: ModelInfo, modelNames: Set<string>, unparsed: UnparsedEntry[]): void {
  const duplicateFieldNames = findDuplicates(model.fields.map((field) => field.name))
  for (const fieldName of duplicateFieldNames) {
    addBlocked(unparsed, `${model.name}.${fieldName}`, `duplicate model field name '${fieldName}'`)
  }

  const mappedNames = new Map<RawField, string>()
  for (const field of model.fields) {
    if (duplicateFieldNames.has(field.name)) continue
    const mappedName = getMappedFieldName(field, `${model.name}.${field.name}`, unparsed)
    if (mappedName) mappedNames.set(field, mappedName)
  }
  const duplicateMappedNames = findDuplicates(
    model.fields
      .filter(
        (field) =>
          !duplicateFieldNames.has(field.name) &&
          !field.isList &&
          !modelNames.has(field.type) &&
          Boolean(SCALAR_TYPES[field.type])
      )
      .map((field) => mappedNames.get(field))
      .filter((name): name is string => name !== undefined)
  )
  for (const columnName of duplicateMappedNames) {
    addBlocked(unparsed, model.name, `duplicate mapped column name '${columnName}'`)
  }

  for (const field of model.fields) {
    const location = `${model.name}.${field.name}`
    if (duplicateFieldNames.has(field.name)) continue
    if (hasDuplicateAttributes(field.attributes)) {
      addBlocked(unparsed, location, 'duplicate field attribute')
      continue
    }

    const mappedName = mappedNames.get(field)
    if (!mappedName) continue

    if (field.isList) {
      if (field.attributes.length > 0 || field.optional) {
        addBlocked(unparsed, location, 'unsupported attributes or optional marker on a list field')
      } else if (!modelNames.has(field.type)) {
        addBlocked(
          unparsed,
          location,
          `unsupported list field type '${field.type}' (enum/scalar/composite/unknown)`
        )
      }
      continue
    }
    if (duplicateMappedNames.has(mappedName)) continue
    if (modelNames.has(field.type)) {
      const relation = getAttribute(field, 'relation')
      const incompatible = field.attributes.find((attribute) => attribute.name !== 'relation')
      if (!relation?.args || incompatible) {
        addBlocked(unparsed, location, 'unsupported or malformed relation field')
        continue
      }
      const relationFields = parseRelationArguments(relation.args)
      if (!relationFields) {
        addBlocked(unparsed, location, 'malformed @relation fields/references arguments')
        continue
      }
      model.pendingRelations.push({
        location,
        localFields: relationFields.localFields,
        refModel: field.type,
        refFields: relationFields.refFields,
      })
      continue
    }

    const neutralType = SCALAR_TYPES[field.type]
    if (!neutralType) {
      addBlocked(
        unparsed,
        location,
        `unsupported field type '${field.type}' (enum/composite/unknown)`
      )
      continue
    }
    if (getAttribute(field, 'relation')) {
      addBlocked(unparsed, location, 'relation attribute on a scalar field')
      continue
    }

    const nativeAttributes = field.attributes.filter((attribute) =>
      attribute.name.startsWith('db.')
    )
    const native = nativeAttributes[0]
    let type = neutralType
    if (native) {
      const nativeName = native.name.slice(3)
      const nativeRule = NATIVE_TYPES[nativeName]
      if (!nativeRule || nativeAttributes.length > 1) {
        addBlocked(unparsed, location, `unsupported native type '@db.${nativeName}'`)
        continue
      }
      const nativeArguments = native.args?.trim()
      if (
        nativeRule.prismaScalar !== field.type ||
        !validNativeArguments(nativeRule.arguments, nativeArguments)
      ) {
        addBlocked(
          unparsed,
          location,
          `malformed or incompatible native type '@db.${nativeName}' for '${field.type}'`
        )
        continue
      }
      type =
        nativeArguments === undefined ? nativeRule.type : `${nativeRule.type}(${nativeArguments})`
    }

    const defaultAttribute = getAttribute(field, 'default')
    if (
      defaultAttribute &&
      (defaultAttribute.args === undefined || !defaultAttribute.args.trim())
    ) {
      addBlocked(unparsed, location, 'malformed @default attribute')
      continue
    }
    if (
      field.attributes.some(
        (attribute) =>
          (attribute.name === 'id' || attribute.name === 'unique') && attribute.args !== undefined
      )
    ) {
      addBlocked(unparsed, location, 'malformed @id or @unique attribute')
      continue
    }

    const column: NormalizedColumn = {
      name: mappedName,
      type,
      rawType: field.type,
      nullable: field.optional,
    }
    if (getAttribute(field, 'id')) column.primaryKey = true
    if (defaultAttribute?.args !== undefined) column.default = defaultAttribute.args.trim()
    model.table.columns.push(column)
    model.columnNames.set(field.name, mappedName)

    if (getAttribute(field, 'unique')) {
      model.table.indexes.push({ name: undefined, columns: [mappedName], unique: true })
    }
  }
}

function resolveIndexes(model: ModelInfo, unparsed: UnparsedEntry[]): void {
  for (const index of model.pendingIndexes) {
    const columns = index.fields.map((field) => model.columnNames.get(field))
    if (columns.some((column) => !column)) {
      addBlocked(unparsed, index.location, `index references an unsupported or missing field`)
      continue
    }
    model.table.indexes.push({
      name: undefined,
      columns: columns as string[],
      unique: index.unique,
    })
  }
}

function resolveRelations(
  model: ModelInfo,
  models: Map<string, ModelInfo>,
  unparsed: UnparsedEntry[]
): void {
  for (const relation of model.pendingRelations) {
    const referencedModel = models.get(relation.refModel)
    const localColumns = relation.localFields.map((field) => model.columnNames.get(field))
    const refColumns = relation.refFields.map((field) => referencedModel?.columnNames.get(field))
    if (
      !referencedModel ||
      localColumns.some((column) => !column) ||
      refColumns.some((column) => !column)
    ) {
      addBlocked(
        unparsed,
        relation.location,
        'relation references an unsupported or missing field/model'
      )
      continue
    }
    model.table.foreignKeys.push({
      columns: localColumns as string[],
      refTable: referencedModel.tableName,
      refColumns: refColumns as string[],
    })
  }
}

function getMappedFieldName(
  field: RawField,
  location: string,
  unparsed: UnparsedEntry[]
): string | undefined {
  const map = getAttribute(field, 'map')
  if (!map) return field.name
  const mapped = parseStringArgument(map.args)
  if (!mapped) {
    addBlocked(unparsed, location, 'malformed @map attribute')
    return undefined
  }
  return mapped
}

function parseAttributes(text: string): AttributeParseResult {
  if (!text) return { attributes: [] }
  const attributes: ParsedAttribute[] = []
  let cursor = 0

  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1
    if (cursor >= text.length) break
    if (text[cursor] !== '@' || text[cursor + 1] === '@') {
      return { error: `blocked: malformed field attributes '${text.slice(cursor)}'` }
    }
    cursor += 1

    const nameMatch = text.slice(cursor).match(/^(?:db\.)?[A-Za-z_]\w*/)
    const name = nameMatch?.[0]
    if (!name) return { error: `blocked: malformed field attribute '${text.slice(cursor - 1)}'` }
    cursor += name.length

    while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1
    let args: string | undefined
    if (text[cursor] === '(') {
      const balanced = readParenthesized(text, cursor)
      if (!balanced) return { error: `blocked: unmatched field attribute parentheses` }
      args = balanced.content
      cursor = balanced.end
    }
    attributes.push(args === undefined ? { name } : { name, args })
  }

  return { attributes }
}

function parseBlockAttribute(line: string): { attribute?: ParsedAttribute; error?: string } {
  const nameMatch = line.match(/^@@([A-Za-z_]\w*)/)
  const name = nameMatch?.[1]
  if (!name || !nameMatch) return { error: `malformed block attribute '${line}'` }
  let cursor = nameMatch[0].length
  while (cursor < line.length && /\s/.test(line[cursor] ?? '')) cursor += 1
  if (line[cursor] !== '(') return { error: `malformed block attribute '@@${name}'` }
  const balanced = readParenthesized(line, cursor)
  if (!balanced || line.slice(balanced.end).trim()) {
    return { error: `malformed block attribute '@@${name}'` }
  }
  return { attribute: { name, args: balanced.content } }
}

function readParenthesized(
  text: string,
  start: number
): { content: string; end: number } | undefined {
  let depth = 0
  let quote: '"' | "'" | undefined
  let escaped = false

  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text[cursor]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0) {
        return { content: text.slice(start + 1, cursor), end: cursor + 1 }
      }
    }
  }
  return undefined
}

function parseStringArgument(args: string | undefined): string | undefined {
  if (args === undefined) return undefined
  const value = args.trim()
  if (!/^"(?:\\.|[^"\\])*"$/.test(value)) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseFieldList(args: string | undefined): string[] | undefined {
  if (args === undefined) return undefined
  const match = args.trim().match(/^\[([^\]]*)\]$/)
  if (!match) return undefined
  const fields = (match[1] ?? '').split(',').map((field) => field.trim())
  if (fields.length === 0 || fields.some((field) => !/^[A-Za-z_]\w*$/.test(field))) {
    return undefined
  }
  return fields
}

function validNativeArguments(rule: NativeArgumentRule, args: string | undefined): boolean {
  if (rule === 'none') return args === undefined
  if (rule === 'positive-integer') return args !== undefined && /^[1-9]\d*$/.test(args)
  return args === undefined || /^(?:0|[1-9]\d*)$/.test(args)
}

function parseRelationArguments(
  args: string
): { localFields: string[]; refFields: string[] } | undefined {
  const forward = args.match(
    /^\s*fields\s*:\s*(\[[^\]]*\])\s*,\s*references\s*:\s*(\[[^\]]*\])\s*$/
  )
  const reverse = args.match(
    /^\s*references\s*:\s*(\[[^\]]*\])\s*,\s*fields\s*:\s*(\[[^\]]*\])\s*$/
  )
  const local = parseFieldList(forward?.[1] ?? reverse?.[2])
  const referenced = parseFieldList(forward?.[2] ?? reverse?.[1])
  if (!local || !referenced || local.length !== referenced.length) return undefined
  return { localFields: local, refFields: referenced }
}

function getAttribute(field: RawField, name: string): ParsedAttribute | undefined {
  return field.attributes.find((attribute) => attribute.name === name)
}

function hasDuplicateAttributes(attributes: ParsedAttribute[]): boolean {
  return new Set(attributes.map((attribute) => attribute.name)).size !== attributes.length
}

function findDuplicates(values: string[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return duplicates
}

function stripLineComment(line: string): string {
  let quoted = false
  let escaped = false
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quoted) {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && character === '/' && line[index + 1] === '/') {
      return line.slice(0, index)
    }
  }
  return line
}

function addBlocked(unparsed: UnparsedEntry[], location: string, detail: string): void {
  unparsed.push({
    location,
    reason: detail.startsWith('blocked:') ? detail : `blocked: ${detail}`,
  })
}

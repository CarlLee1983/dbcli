import { describe, test, expect } from 'bun:test'
import { Command } from 'commander'
import {
  buildCompletionTree,
  listTopLevelCommandNames,
  findCommandPath,
  flattenCommandTree,
} from '../../../src/core/completion/command-tree'

function fixtureProgram(): Command {
  const program = new Command().name('dbcli').description('root')
  program.option('--config <path>', 'config path')

  const queries = new Command('queries').description('manage snippets')
  const list = new Command('list').description('list snippets')
  list.option('--format <type>', 'output format')
  list.option('--tag <tag>', 'filter by tag')
  queries.addCommand(list)
  program.addCommand(queries)

  const blacklist = new Command('blacklist').description('blacklist')
  const table = new Command('table').description('table rules')
  const add = new Command('add <table>').description('add table')
  table.addCommand(add)
  blacklist.addCommand(table)
  program.addCommand(blacklist)

  return program
}

describe('buildCompletionTree', () => {
  test('builds root with options and recursive children', () => {
    const root = buildCompletionTree(fixtureProgram())
    expect(root.name).toBe('dbcli')
    expect(root.options.map((o) => o.long)).toContain('--config')
    const queries = root.children.find((c) => c.name === 'queries')
    expect(queries).toBeDefined()
    const list = queries!.children.find((c) => c.name === 'list')
    expect(list).toBeDefined()
    expect(list!.options.map((o) => o.long)).toEqual(['--format', '--tag'])
  })

  test('captures option value shape', () => {
    const root = buildCompletionTree(fixtureProgram())
    const list = findCommandPath(root, ['queries', 'list'])!
    const format = list.options.find((o) => o.long === '--format')!
    expect(format.requiredValue).toBe(true)
    expect(format.optionalValue).toBe(false)
  })
})

describe('listTopLevelCommandNames', () => {
  test('returns first-level command names', () => {
    const root = buildCompletionTree(fixtureProgram())
    expect(listTopLevelCommandNames(root)).toEqual(['queries', 'blacklist'])
  })
})

describe('findCommandPath', () => {
  test('resolves a nested path', () => {
    const root = buildCompletionTree(fixtureProgram())
    const add = findCommandPath(root, ['blacklist', 'table', 'add <table>'])
    // command name keeps Commander argument syntax; resolve by registered name
    expect(findCommandPath(root, ['blacklist', 'table'])!.name).toBe('table')
    expect(add).toBeUndefined() // 'add <table>' name is 'add'
    expect(findCommandPath(root, ['blacklist', 'table', 'add'])!.name).toBe('add')
  })

  test('returns undefined for unknown path', () => {
    const root = buildCompletionTree(fixtureProgram())
    expect(findCommandPath(root, ['nope'])).toBeUndefined()
  })
})

describe('flattenCommandTree', () => {
  test('emits root (empty path) plus every command path', () => {
    const root = buildCompletionTree(fixtureProgram())
    const paths = flattenCommandTree(root).map((e) => e.path.join(' '))
    expect(paths).toContain('') // root
    expect(paths).toContain('queries')
    expect(paths).toContain('queries list')
    expect(paths).toContain('blacklist table')
    expect(paths).toContain('blacklist table add')
  })
})

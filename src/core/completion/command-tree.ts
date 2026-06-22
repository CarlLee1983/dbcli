import type { Command, Option } from 'commander'

export interface CompletionOption {
  readonly long?: string
  readonly short?: string
  readonly requiredValue: boolean
  readonly optionalValue: boolean
  readonly description: string
}

export interface CompletionCommandNode {
  readonly name: string
  readonly description: string
  readonly options: readonly CompletionOption[]
  readonly children: readonly CompletionCommandNode[]
}

export interface CompletionPathEntry {
  readonly path: readonly string[]
  readonly node: CompletionCommandNode
}

function toOption(opt: Option): CompletionOption {
  return {
    long: opt.long,
    short: opt.short,
    requiredValue: opt.required ?? false,
    optionalValue: opt.optional ?? false,
    description: opt.description ?? '',
  }
}

export function buildCompletionTree(program: Command): CompletionCommandNode {
  function build(cmd: Command): CompletionCommandNode {
    // Commander may include argument syntax in the name (e.g. 'add <table>');
    // strip to the bare command word so lookups are predictable.
    const rawName = cmd.name()
    const name = rawName.split(' ')[0] ?? rawName
    return {
      name,
      description: cmd.description() ?? '',
      options: cmd.options.map(toOption),
      children: cmd.commands.map(build),
    }
  }
  return build(program)
}

export function listTopLevelCommandNames(root: CompletionCommandNode): string[] {
  return root.children.map((c) => c.name)
}

export function findCommandPath(
  root: CompletionCommandNode,
  path: readonly string[]
): CompletionCommandNode | undefined {
  let node: CompletionCommandNode | undefined = root
  for (const name of path) {
    if (!node) return undefined
    node = node.children.find((c) => c.name === name)
  }
  return node
}

export function flattenCommandTree(root: CompletionCommandNode): CompletionPathEntry[] {
  const out: CompletionPathEntry[] = []
  function walk(node: CompletionCommandNode, path: readonly string[]): void {
    out.push({ path, node })
    for (const child of node.children) {
      walk(child, [...path, child.name])
    }
  }
  walk(root, [])
  return out
}

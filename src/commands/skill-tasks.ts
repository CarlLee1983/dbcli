import { Command } from 'commander'
import {
  filterTasks,
  loadAgentTasks,
  planAgentTask,
  renderMarkdownPlan,
  resolveAgentTaskDirs,
  resolveTaskByName,
  type AgentTaskEngine,
  type AgentTaskSource,
} from '@/core/agent-tasks'

interface ListOptions {
  format?: 'table' | 'json'
  tag?: string
  engine?: AgentTaskEngine
  source?: AgentTaskSource
}

interface ShowOptions {
  format?: 'markdown' | 'json'
}

interface PlanOptions {
  format?: 'markdown' | 'json'
  param?: string[]
}

export function registerSkillTasksCommand(parent: Command): Command {
  const tasks = parent.command('tasks').description('Discover and plan AI-agent task templates')

  tasks
    .command('list')
    .description('List available agent task templates')
    .option('--format <type>', 'Output format: table | json', 'table')
    .option('--tag <tag>', 'Filter by tag')
    .option(
      '--engine <engine>',
      'Filter by engine: postgres | mysql | mongodb | redis | elasticsearch'
    )
    .option('--source <source>', 'Filter by source: builtin | shared | local')
    .action(async (options: ListOptions) => {
      try {
        await runList(options)
      } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
      }
    })

  tasks
    .command('show <task>')
    .description('Show full task definition and notes')
    .option('--format <type>', 'Output format: markdown | json', 'markdown')
    .action(async (taskName: string, options: ShowOptions) => {
      try {
        await runShow(taskName, options)
      } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
      }
    })

  tasks
    .command('plan <task>')
    .description('Generate an executable plan for a task (no execution)')
    .option('--format <type>', 'Output format: markdown | json', 'markdown')
    .option(
      '--param <kv>',
      'Pass parameter as key=value (repeatable)',
      (val: string, prev: string[] = []) => prev.concat([val]),
      [] as string[]
    )
    .action(async (taskName: string, options: PlanOptions) => {
      try {
        await runPlan(taskName, options)
      } catch (e) {
        console.error((e as Error).message)
        process.exit(1)
      }
    })

  return tasks
}

async function runList(options: ListOptions): Promise<void> {
  const map = await loadAgentTasks(resolveAgentTaskDirs(process.cwd()))
  const filtered = filterTasks(map, {
    tag: options.tag,
    engine: options.engine,
    source: options.source,
  })

  if (options.format === 'json') {
    const json = filtered.map((entry) => ({
      name: entry.task.name,
      description: entry.task.description,
      source: entry.task.source,
      tags: entry.task.tags,
      engines: entry.task.engines,
      hasOverride: entry.hasOverride || undefined,
      params: entry.task.params.map((p) => ({
        name: p.name,
        type: p.type,
        ...(p.required ? { required: true } : {}),
        ...(p.default !== undefined ? { default: p.default } : {}),
      })),
      file: entry.task.file,
    }))
    console.log(JSON.stringify(json, null, 2))
    return
  }

  if (filtered.length === 0) {
    console.log('No agent tasks found.')
    return
  }

  const header = ['NAME', 'SOURCE', 'ENGINES', 'TAGS', 'DESCRIPTION']
  const rows = filtered.map((entry) => [
    entry.task.name + (entry.hasOverride ? '*' : ''),
    entry.task.source,
    (entry.task.engines ?? []).join(',') || '-',
    entry.task.tags.join(',') || '-',
    entry.task.description ?? '',
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const fmt = (line: string[]) => line.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ')
  console.log(fmt(header))
  for (const r of rows) console.log(fmt(r))
}

async function runShow(taskName: string, options: ShowOptions): Promise<void> {
  const map = await loadAgentTasks(resolveAgentTaskDirs(process.cwd()))
  const entry = resolveTaskByName(map, taskName)
  const task = entry.task

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          name: task.name,
          description: task.description,
          source: task.source,
          file: task.file,
          tags: task.tags,
          engines: task.engines,
          params: task.params,
          safety: task.safety,
          steps: task.steps,
          notes: task.notes,
        },
        null,
        2
      )
    )
    return
  }

  console.log(`# ${task.name} (${task.source})`)
  if (task.description) console.log(task.description)
  console.log('')
  console.log(`- file: ${task.file}`)
  if (task.engines) console.log(`- engines: ${task.engines.join(', ')}`)
  if (task.tags.length > 0) console.log(`- tags: ${task.tags.join(', ')}`)
  console.log(`- safety: ${task.safety.mode}`)
  if (task.safety.requires?.length) {
    console.log(`- requires: ${task.safety.requires.join(', ')}`)
  }
  if (task.params.length > 0) {
    console.log('\n## Parameters')
    for (const p of task.params) {
      const def = p.default !== undefined ? ` (default: ${p.default})` : ''
      const req = p.required ? ' (required)' : ''
      console.log(`- ${p.name}: ${p.type}${req}${def}`)
      if (p.description) console.log(`    ${p.description}`)
    }
  }
  console.log('\n## Steps')
  task.steps.forEach((s, i) => {
    console.log(`${i + 1}. \`${s.command}\``)
    if (s.reason) console.log(`   reason: ${s.reason}`)
    if (s.risk) console.log(`   risk: ${s.risk}`)
  })
  if (task.notes) {
    console.log('\n## Notes\n')
    console.log(task.notes)
  }
}

async function runPlan(taskName: string, options: PlanOptions): Promise<void> {
  const map = await loadAgentTasks(resolveAgentTaskDirs(process.cwd()))
  const entry = resolveTaskByName(map, taskName)
  const params = parseParamPairs(options.param ?? [])
  const plan = planAgentTask({ task: entry.task, params })

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          name: plan.name,
          source: plan.source,
          file: plan.file,
          description: plan.description,
          mode: plan.mode,
          requires: plan.requires,
          parameters: plan.parameters,
          steps: plan.steps,
          warnings: plan.warnings,
          ...(plan.verification ? { verification: plan.verification } : {}),
        },
        null,
        2
      )
    )
    return
  }
  console.log(renderMarkdownPlan(plan))
}

function parseParamPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pairs) {
    const eq = p.indexOf('=')
    if (eq === -1) {
      throw new Error(`Invalid --param '${p}' (expected key=value)`)
    }
    out[p.slice(0, eq).trim()] = p.slice(eq + 1)
  }
  return out
}

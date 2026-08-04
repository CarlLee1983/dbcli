import { Command } from 'commander'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { readV2Config } from '@/core/config-v2'
import { resolveConfigPath } from '@/utils/config-path'
import {
  buildBackfillArtifact,
  parseBackfillSourceManifest,
  type BackfillConnectionIdentity,
} from '@/core/backfill-artifact'

function identityFor(
  config: Awaited<ReturnType<typeof readV2Config>>,
  name: string
): BackfillConnectionIdentity {
  const connection = config.connections[name]
  if (!connection) {
    throw new Error(
      `Connection '${name}' was not found. Available connections: ${Object.keys(config.connections).join(', ')}`
    )
  }
  const host =
    typeof connection.host === 'string' && connection.host.length > 0 ? connection.host : null
  const database =
    typeof connection.database === 'string' && connection.database.length > 0
      ? connection.database
      : null
  return {
    name,
    environment: connection.environment ?? null,
    permission: connection.permission,
    system: connection.system,
    server: {
      host,
      port: host !== null && typeof connection.port === 'number' ? connection.port : null,
    },
    database,
  }
}

export const backfillCommand = new Command('backfill').description(
  'Generate reviewable source-to-SQL backfill artifacts; never executes writes'
)

backfillCommand
  .command('artifact')
  .description(
    'Build a dry-run backfill artifact from a bounded JSON source catalog and two named connections'
  )
  .requiredOption(
    '--source <path>',
    'JSON source catalog with table, keyColumns, rows, verifyQuery, and expect'
  )
  .requiredOption(
    '--source-use <name>',
    'Named source connection used to identify the catalog environment'
  )
  .requiredOption('--target-use <name>', 'Named target connection for generated SQL')
  .option('--out <path>', 'Write artifact JSON to this path')
  .option('--stdout', 'Print artifact JSON instead of writing it', false)
  .action(
    async (
      options: {
        source: string
        sourceUse: string
        targetUse: string
        out?: string
        stdout: boolean
      },
      command: Command
    ) => {
      const configPath = resolveConfigPath(command)
      const config = await readV2Config(configPath)
      const sourcePath = resolve(options.source)
      const sourceContent = await Bun.file(sourcePath).text()
      let raw: unknown
      try {
        raw = JSON.parse(sourceContent)
      } catch {
        throw new Error(`Source catalog is not valid JSON: ${sourcePath}`)
      }
      const artifact = buildBackfillArtifact({
        manifest: parseBackfillSourceManifest(raw),
        sourcePath,
        sourceContent,
        sourceIdentity: identityFor(config, options.sourceUse),
        targetIdentity: identityFor(config, options.targetUse),
      })

      if (options.stdout) {
        console.log(JSON.stringify(artifact, null, 2))
        return
      }
      const out = resolve(
        options.out ?? `.dbcli/backfills/${artifact.source.sha256.slice(0, 12)}.json`
      )
      await mkdir(dirname(out), { recursive: true })
      await Bun.write(out, JSON.stringify(artifact, null, 2) + '\n')
      console.log(JSON.stringify({ path: out, artifact }, null, 2))
    }
  )

import { readFile } from 'node:fs/promises'
import { ConfigError } from './errors'

function parseEnvContent(content: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    entries.push([key, value])
  }

  return entries
}

/**
 * Load a file into process.env without overwriting existing values.
 *
 * Uses `node:fs` rather than `Bun.file` on purpose: `agent-core` is the public
 * surface downstream tools consume, and those tools do not necessarily run on
 * Bun. A Bun-only builtin here makes the whole export unusable for them.
 */
export async function loadEnvFile(filePath: string): Promise<void> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EISDIR') {
      throw new ConfigError(`找不到 env 檔案：${filePath}`)
    }
    throw cause
  }

  for (const [key, value] of parseEnvContent(content)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

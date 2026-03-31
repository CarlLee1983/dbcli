/**
 * Load environment variables from a file into process.env
 * Does NOT overwrite existing variables (consistent with dotenv convention)
 */

import { ConfigError } from '@/utils/errors'

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

export async function loadEnvFile(filePath: string): Promise<void> {
  const file = Bun.file(filePath)
  const exists = await file.exists()

  if (!exists) {
    throw new ConfigError(`找不到 env 檔案：${filePath}`)
  }

  const content = await file.text()
  const entries = parseEnvContent(content)

  for (const [key, value] of entries) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

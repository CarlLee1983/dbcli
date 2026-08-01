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

/** Load a file into process.env without overwriting existing values. */
export async function loadEnvFile(filePath: string): Promise<void> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) throw new ConfigError(`找不到 env 檔案：${filePath}`)

  for (const [key, value] of parseEnvContent(await file.text())) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

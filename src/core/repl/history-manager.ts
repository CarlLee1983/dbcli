// src/core/repl/history-manager.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_MAX = 1000

export class HistoryManager {
  private entries: string[]
  private readonly maxEntries: number

  constructor(
    private readonly filePath: string,
    maxEntries: number = DEFAULT_MAX,
  ) {
    this.maxEntries = maxEntries
    this.entries = this.load()
  }

  add(entry: string): void {
    const trimmed = entry.trim()
    if (trimmed === '') return

    // Skip consecutive duplicates
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      return
    }

    this.entries.push(trimmed)

    // Trim to max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(this.entries.length - this.maxEntries)
    }
  }

  getAll(): readonly string[] {
    return this.entries
  }

  async save(): Promise<void> {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, this.entries.join('\n') + '\n', 'utf-8')
  }

  private load(): string[] {
    if (!existsSync(this.filePath)) {
      return []
    }

    const content = readFileSync(this.filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim() !== '')

    if (lines.length > this.maxEntries) {
      return lines.slice(lines.length - this.maxEntries)
    }

    return lines
  }
}

/** Read-only observer. The log's attestation is evidence, never an EOF inference. */
import { open } from 'node:fs/promises'

const usage = 'Usage: bun run scripts/verification-progress.ts <verify.log> [--follow]'
const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
  console.log(usage)
} else if (
  args.length < 1 ||
  args.length > 2 ||
  args[0]?.startsWith('-') ||
  (args.length === 2 && args[1] !== '--follow')
) {
  console.error(usage)
  process.exitCode = 1
} else {
  try {
    await observe(args[0]!, args[1] === '--follow')
  } catch {
    // File names and OS errors can contain credentials. Keep diagnostics fixed.
    console.error('Cannot observe log: expected a readable regular file.')
    process.exitCode = 1
  }
}

async function observe(path: string, follow: boolean): Promise<void> {
  const file = await open(path, 'r')
  try {
    if (!(await file.stat()).isFile()) throw new Error('not a regular file')
    let offset = 0
    let pending = ''
    let dropping = false
    let current: string | undefined
    let running = false
    const seen = new Set<string>()
    const recent: string[] = []
    let verdict: 'PASS' | 'FAIL' | undefined
    let live = false
    const emit = (event: string) => {
      recent.push(event)
      if (recent.length > 12) recent.shift()
      if (live) console.log(event)
    }
    const line = (text: string) => {
      const start = /^==> \[([1-9]\d{0,2})\] .{1,2048}$/.exec(text)
      const end = /^<== \[([1-9]\d{0,2})\] .{1,2048} (\d{1,8})s exit (\d{1,3})$/.exec(text)
      if (start || end) {
        const index = (start ?? end)![1]!
        if (start && index === '1' && verdict !== undefined) {
          verdict = undefined
          seen.clear()
          recent.length = 0
        }
        const key = `${index}:${start ? 'start' : 'end'}`
        if (seen.has(key)) return
        seen.add(key)
        current = index
        running = Boolean(start)
        if (start) emit(`START [${index}]`)
        else emit(`END [${index}] ${end![2]}s exit ${end![3]}`)
      } else {
        const result =
          /^verification attestation: (PASS|FAIL) at [a-f0-9]{40} \(sha256:[a-f0-9]{64}\)$/.exec(
            text
          )
        if (result && verdict === undefined) {
          verdict = result[1] as 'PASS' | 'FAIL'
          emit(`ATTESTATION ${verdict}`)
        }
      }
    }
    const summary = () => {
      if (verdict) return `Summary: attestation ${verdict}`
      return `Summary: ${running ? `IN_PROGRESS step [${current}]` : 'UNKNOWN'}; attestation UNKNOWN`
    }
    const bytes = new Uint8Array(64 * 1024)
    const decoder = new TextDecoder()
    const read = async () => {
      const size = (await file.stat()).size
      while (offset < size) {
        const { bytesRead } = await file.read(
          bytes,
          0,
          Math.min(bytes.length, size - offset),
          offset
        )
        if (bytesRead === 0) break
        offset += bytesRead
        const text = decoder.decode(bytes.subarray(0, bytesRead), { stream: true })
        for (const char of text) {
          if (char === '\n') {
            if (!dropping) line(pending.endsWith('\r') ? pending.slice(0, -1) : pending)
            pending = ''
            dropping = false
          } else if (!dropping) {
            pending += char
            if (pending.length > 4096) {
              pending = ''
              dropping = true
            }
          }
        }
      }
    }
    await read()
    recent.forEach((event) => console.log(event))
    console.log(summary())
    if (!follow) return
    live = true
    let stopped = false
    const stop = () => {
      stopped = true
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    try {
      while (!stopped) {
        await Bun.sleep(100)
        await read()
      }
      console.log(summary())
      process.exitCode = 130
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    }
  } finally {
    await file.close()
  }
}

/**
 * Interactive prompts module with @inquirer/prompts and synchronous fallback.
 *
 * Attempts to use @inquirer/prompts for rich interactive experience.
 * If that fails (due to Bun compatibility issues), falls back to simple
 * console-based prompts using Bun's built-in stdin.
 *
 * Two failures used to be indistinguishable here, and both were swallowed
 * (#56). Loading the module can fail — a bundle that tree-shook the prompt
 * implementations away leaves an intact barrel that throws on import, which is
 * how every interactive prompt silently degraded to plain text for however
 * long. That case warns, once, and falls back. The prompt *call* failing is a
 * different thing entirely: that is the user pressing Ctrl-C, and re-asking
 * them in plain text is the opposite of what they wanted, so it propagates.
 */

let promptsUnavailableReported = false

/**
 * Load @inquirer/prompts, reporting unavailability once per process.
 *
 * Returns undefined rather than throwing so each prompt can fall back, but the
 * degradation is never silent again.
 */
async function loadInquirer(): Promise<typeof import('@inquirer/prompts') | undefined> {
  try {
    return await import('@inquirer/prompts')
  } catch (error) {
    if (!promptsUnavailableReported) {
      promptsUnavailableReported = true
      const reason = error instanceof Error ? error.message : String(error)
      process.stderr.write(
        `[dbcli] rich interactive prompts are unavailable (${reason}); ` +
          'falling back to plain-text input\n'
      )
    }
    return undefined
  }
}

/**
 * Read a line from stdin using Node.js compatible API.
 * This is a fallback for when @inquirer/prompts is unavailable.
 */
async function readLineFromStdin(prompt: string = ''): Promise<string> {
  return new Promise((resolve) => {
    if (prompt) {
      process.stdout.write(prompt)
    }

    let data = ''
    const chunks: Buffer[] = []

    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      data = Buffer.concat(chunks).toString()
      const lines = data.split('\n')

      if (lines.length > 1) {
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        process.stdin.removeListener('end', onEnd)
        resolve((lines[0] ?? '').trim())
      }
    }

    const onEnd = () => {
      process.stdin.removeListener('data', onData)
      resolve(data.trim())
    }

    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.resume()
  })
}

async function textFallback(message: string, defaultValue?: string): Promise<string> {
  // The question goes to stderr for the same reason `confirmFallback` sends its
  // own there: it is addressed to a person, and stdout is what a caller parses.
  // This path is reached exactly when stdin is not a terminal, which is when
  // something is most likely reading stdout.
  const displayMessage = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `
  process.stderr.write(displayMessage)
  const answer = await readLineFromStdin()
  return answer.trim() || defaultValue || ''
}

async function selectFallback(message: string, choices: string[]): Promise<string> {
  console.log(message)
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}) ${choice}`)
  })

  const answer = await readLineFromStdin('Select option (number): ')
  const selectedIndex = parseInt(answer, 10) - 1

  if (selectedIndex >= 0 && selectedIndex < choices.length) {
    return choices[selectedIndex] ?? choices[0] ?? ''
  }

  return choices[0] ?? ''
}

async function confirmFallback(message: string): Promise<boolean> {
  // The question goes to stderr: a confirmation is asked of a person, while
  // stdout is the channel a caller parses. This path is reached exactly when
  // stdin is not a terminal — a piped answer, which is also when stdout is most
  // likely being read by something.
  process.stderr.write(`${message} (y/n): `)
  const answer = await readLineFromStdin()
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
}

/**
 * Prompt user for text input with optional default value.
 *
 * @param message - The prompt message to display
 * @param defaultValue - Default value if user provides empty input
 * @returns The user's input or the default value
 */
export async function text(message: string, defaultValue?: string): Promise<string> {
  // Skip inquirer if not a TTY (e.g., piped input)
  if (!process.stdin.isTTY) return textFallback(message, defaultValue)

  const inquirer = await loadInquirer()
  if (!inquirer) return textFallback(message, defaultValue)

  // Same reason as `confirm`: the question is for the person, not for whatever
  // is reading stdout. This is the prompt the tier-two write gate uses.
  return await inquirer.input({ message, default: defaultValue }, { output: process.stderr })
}

/**
 * Prompt user to select from a list of choices.
 *
 * @param message - The prompt message to display
 * @param choices - Array of choices for the user to select from
 * @returns The selected choice
 */
export async function select(message: string, choices: string[]): Promise<string> {
  // Skip inquirer if not a TTY (e.g., piped input)
  if (!process.stdin.isTTY) return await selectFallback(message, choices)

  const inquirer = await loadInquirer()
  if (!inquirer) return await selectFallback(message, choices)

  return await inquirer.select({ message, choices })
}

/** How much of the unavailability message may reach the terminal. */
const SECRET_ERROR_CAP = 300

/** Guidance used when a caller does not name the inputs its own mode supports. */
const DEFAULT_SECRET_GUIDANCE = 'pass the value with --stdin or --password instead'

export interface SecretPromptOptions {
  /**
   * What the caller's own mode accepts instead of typing — `--password`,
   * `--uri`, an environment reference. Named by the caller because only it
   * knows which of those the active init mode actually supports.
   */
  unavailable?: string
}

/**
 * The error raised when a secret cannot be collected without echoing it.
 *
 * The underlying cause is deliberately not reproduced: a bundler or loader
 * message names internal paths and helps nobody choose a different input.
 */
export function maskedInputUnavailableError(guidance: string, _cause?: unknown): Error {
  const message = `Masked input is unavailable; ${guidance.trim() || DEFAULT_SECRET_GUIDANCE}.`
  return new Error(
    message.length <= SECRET_ERROR_CAP ? message : `${message.slice(0, SECRET_ERROR_CAP - 1)}\u2026`
  )
}

/**
 * Prompt for a secret. The value is masked while typing and never echoed back.
 *
 * Requires a TTY and a working masked prompt. There is no plain-text fallback
 * by design: falling back would print the secret into terminal scrollback,
 * which is the exact outcome the caller asked to avoid. Callers must supply
 * the value through an input their own mode supports instead.
 *
 * @param message - The prompt message to display
 * @param options - Guidance naming the inputs the caller's mode supports
 * @returns The entered secret, exactly as typed
 */
export async function secret(message: string, options?: SecretPromptOptions): Promise<string> {
  const guidance = options?.unavailable ?? DEFAULT_SECRET_GUIDANCE

  if (!process.stdin.isTTY) throw maskedInputUnavailableError(guidance)

  // Imported here rather than through `loadInquirer`: that helper reports the
  // raw loader error on stderr before falling back, and a secret has no
  // fallback to report.
  let inquirer: typeof import('@inquirer/prompts')
  try {
    inquirer = await import('@inquirer/prompts')
  } catch (error) {
    throw maskedInputUnavailableError(guidance, error)
  }

  return await inquirer.password({ message, mask: '*' })
}

/**
 * Prompt user for a yes/no confirmation.
 *
 * @param message - The confirmation prompt message
 * @returns True if user confirms (y/yes), false otherwise
 */
export async function confirm(message: string): Promise<boolean> {
  // Skip inquirer if not a TTY (e.g., piped input)
  if (!process.stdin.isTTY) return await confirmFallback(message)

  const inquirer = await loadInquirer()
  if (!inquirer) return await confirmFallback(message)

  // Same reason as confirmFallback: the question is for the person, so it must
  // not land in whatever is reading stdout.
  return await inquirer.confirm({ message }, { output: process.stderr })
}

/**
 * Export promptUser object with all prompt functions.
 * This allows easy mocking in tests.
 */
export const promptUser = {
  text,
  select,
  confirm,
  secret,
}

export default promptUser

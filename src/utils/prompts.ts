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

/**
 * Prompt for a secret. The value is masked while typing and never echoed back.
 *
 * Requires a TTY: without inquirer's masking, a plain-text fallback would print
 * the secret into the terminal scrollback, so callers must supply the value
 * through a flag or stdin instead.
 *
 * @param message - The prompt message to display
 * @returns The entered secret, exactly as typed
 */
export async function secret(message: string): Promise<string> {
  const inquirer = await loadInquirer()
  if (!inquirer) {
    throw new Error(
      'Masked input is unavailable; pass the value with --stdin or --password instead.'
    )
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

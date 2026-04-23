/**
 * Interactive prompts module with @inquirer/prompts and synchronous fallback.
 *
 * Attempts to use @inquirer/prompts for rich interactive experience.
 * If that fails (due to Bun compatibility issues), falls back to simple
 * console-based prompts using Bun's built-in stdin.
 */

import { stdin } from 'bun'

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
        resolve(lines[0].trim())
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

/**
 * Prompt user for text input with optional default value.
 *
 * @param message - The prompt message to display
 * @param defaultValue - Default value if user provides empty input
 * @returns The user's input or the default value
 */
export async function text(message: string, defaultValue?: string): Promise<string> {
  // Skip inquirer if not a TTY (e.g., piped input)
  if (!process.stdin.isTTY) {
    const displayMessage = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `
    const answer = await readLineFromStdin(displayMessage)
    return answer.trim() || defaultValue || ''
  }

  try {
    const { text: inquirerText } = await import('@inquirer/prompts')
    return await inquirerText({ message, default: defaultValue })
  } catch {
    // Fallback: use simple console prompts
    const displayMessage = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `
    const answer = await readLineFromStdin(displayMessage)
    return answer.trim() || defaultValue || ''
  }
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
  if (!process.stdin.isTTY) {
    console.log(message)
    choices.forEach((choice, index) => {
      console.log(`  ${index + 1}) ${choice}`)
    })

    const answer = await readLineFromStdin('Select option (number): ')
    const selectedIndex = parseInt(answer, 10) - 1

    if (selectedIndex >= 0 && selectedIndex < choices.length) {
      return choices[selectedIndex]
    }

    return choices[0]
  }

  try {
    const { select: inquirerSelect } = await import('@inquirer/prompts')
    return await inquirerSelect({ message, choices })
  } catch {
    // Fallback: print choices and ask user to select
    console.log(message)
    choices.forEach((choice, index) => {
      console.log(`  ${index + 1}) ${choice}`)
    })

    const answer = await readLineFromStdin('Select option (number): ')
    const selectedIndex = parseInt(answer, 10) - 1

    if (selectedIndex >= 0 && selectedIndex < choices.length) {
      return choices[selectedIndex]
    }

    return choices[0]
  }
}

/**
 * Prompt user for a yes/no confirmation.
 *
 * @param message - The confirmation prompt message
 * @returns True if user confirms (y/yes), false otherwise
 */
export async function confirm(message: string): Promise<boolean> {
  // Skip inquirer if not a TTY (e.g., piped input)
  if (!process.stdin.isTTY) {
    const answer = await readLineFromStdin(`${message} (y/n): `)
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
  }

  try {
    const { confirm: inquirerConfirm } = await import('@inquirer/prompts')
    return await inquirerConfirm({ message })
  } catch {
    // Fallback: simple y/n prompt
    const answer = await readLineFromStdin(`${message} (y/n): `)
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes'
  }
}

/**
 * Export promptUser object with all prompt functions.
 * This allows easy mocking in tests.
 */
export const promptUser = {
  text,
  select,
  confirm,
}

export default promptUser

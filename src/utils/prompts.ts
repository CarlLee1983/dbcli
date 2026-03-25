/**
 * Interactive prompts module with @inquirer/prompts and synchronous fallback.
 *
 * Attempts to use @inquirer/prompts for rich interactive experience.
 * If that fails (due to Bun compatibility issues), falls back to simple
 * console-based prompts using Bun's built-in stdin.
 */

import { stdin } from 'bun'

/**
 * Read a line from stdin synchronously.
 * This is a fallback for when @inquirer/prompts is unavailable.
 */
async function readLineFromStdin(prompt: string = ''): Promise<string> {
  return new Promise((resolve) => {
    if (prompt) {
      process.stdout.write(prompt)
    }

    let data = ''
    stdin.on('data', (chunk) => {
      data += chunk.toString()
      const lines = data.split('\n')
      if (lines.length > 1) {
        stdin.pause()
        resolve(lines[0])
      }
    })

    stdin.on('end', () => {
      resolve(data.trim())
    })

    stdin.resume()
  })
}

/**
 * Prompt user for text input with optional default value.
 *
 * @param message - The prompt message to display
 * @param defaultValue - Default value if user provides empty input
 * @returns The user's input or the default value
 */
export async function text(
  message: string,
  defaultValue?: string
): Promise<string> {
  try {
    const { text: inquirerText } = await import('@inquirer/prompts')
    return await inquirerText({ message, default: defaultValue })
  } catch (error) {
    // Fallback: use simple console prompts
    const displayMessage = defaultValue
      ? `${message} [${defaultValue}]: `
      : `${message}: `
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
export async function select(
  message: string,
  choices: string[]
): Promise<string> {
  try {
    const { select: inquirerSelect } = await import('@inquirer/prompts')
    return await inquirerSelect({ message, choices })
  } catch (error) {
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

    // Default to first choice if invalid
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
  try {
    const { confirm: inquirerConfirm } = await import('@inquirer/prompts')
    return await inquirerConfirm({ message })
  } catch (error) {
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
  confirm
}

export default promptUser

export interface Messages {
  [key: string]: any
}

/**
 * MessageLoader singleton class for i18n support.
 * Loads language-specific JSON message files at instantiation.
 * Supports English primary with Traditional Chinese fallback.
 */
export class MessageLoader {
  private static instance: MessageLoader | null = null
  private messages: Messages = {}
  private fallbackMessages: Messages = {}
  private currentLang: string

  private constructor() {
    this.currentLang = Bun.env.DBCLI_LANG || 'en'
    this.loadMessages()
  }

  /**
   * Get or create the singleton instance.
   * Lazily initializes on first call.
   */
  static getInstance(): MessageLoader {
    if (!MessageLoader.instance) {
      MessageLoader.instance = new MessageLoader()
    }
    return MessageLoader.instance
  }

  /**
   * Load language files synchronously.
   * Always loads English as fallback.
   */
  private loadMessages(): void {
    try {
      // Load requested language
      if (this.currentLang !== 'en') {
        this.messages = this.loadLanguageFile(this.currentLang)
      }
      // Always load English as fallback
      this.fallbackMessages = this.loadLanguageFile('en')
    } catch (error) {
      console.error('Failed to load messages:', error)
      throw new Error('Failed to initialize message loader')
    }
  }

  /**
   * Load a specific language file synchronously.
   * Uses Bun.file().json() for optimal CLI performance.
   */
  private loadLanguageFile(lang: string): Messages {
    try {
      // Build path relative to this file's directory
      const dir = import.meta.dir
      const filePath = `${dir}/../../resources/lang/${lang}/messages.json`

      // Load JSON file directly
      const messages = require(filePath)

      if (!messages || typeof messages !== 'object') {
        throw new Error(`Language file contains invalid data: ${lang}`)
      }

      return messages as Messages
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Language file error (${lang}): ${error.message}`)
      }
      throw error
    }
  }

  /**
   * Retrieve a message by key.
   * Supports dot notation (e.g., "init.welcome" → messages.init.welcome)
   * Falls back: current language → English → key name
   */
  t(key: string): string {
    const parts = key.split('.')
    let value: Messages | string | undefined = this.messages

    // Try to navigate through current language messages
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part]
      } else {
        value = undefined
        break
      }
    }

    if (typeof value === 'string') {
      return value
    }

    // Fallback to English
    value = this.fallbackMessages
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part]
      } else {
        value = undefined
        break
      }
    }

    if (typeof value === 'string') {
      return value
    }

    // Last resort: return key name
    return key
  }

  /**
   * Interpolate variables in a message.
   * Replaces {varName} with values from vars object.
   * Supports multiple variables.
   */
  interpolate(key: string, vars: Record<string, string | number>): string {
    let message = this.t(key)

    for (const [varName, value] of Object.entries(vars)) {
      // Escape special regex characters in varName
      const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`{${escapedVarName}}`, 'g')
      message = message.replace(regex, String(value))
    }

    return message
  }
}

// Export singleton instance
export const messageLoader = MessageLoader.getInstance()

// Export convenience functions
export const t = (key: string): string => messageLoader.t(key)

export const t_vars = (
  key: string,
  vars: Record<string, string | number>
): string => messageLoader.interpolate(key, vars)

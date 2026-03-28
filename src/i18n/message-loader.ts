import enMessages from '../../resources/lang/en/messages.json'
import zhTWMessages from '../../resources/lang/zh-TW/messages.json'
import shellEnMessages from '../../resources/lang/en/shell.json'
import shellZhTWMessages from '../../resources/lang/zh-TW/shell.json'

export interface Messages {
  [key: string]: any
}

const BUNDLED_MESSAGES: Record<string, Messages> = {
  en: { ...(enMessages as Messages), shell: shellEnMessages },
  'zh-TW': { ...(zhTWMessages as Messages), shell: shellZhTWMessages },
}

/**
 * MessageLoader singleton class for i18n support.
 * Language files are bundled at build time for reliable path resolution.
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

  static getInstance(): MessageLoader {
    if (!MessageLoader.instance) {
      MessageLoader.instance = new MessageLoader()
    }
    return MessageLoader.instance
  }

  private loadMessages(): void {
    if (this.currentLang !== 'en') {
      this.messages = BUNDLED_MESSAGES[this.currentLang] || {}
    }
    this.fallbackMessages = BUNDLED_MESSAGES['en'] || {}
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

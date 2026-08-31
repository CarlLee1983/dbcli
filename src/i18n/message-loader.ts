import enMessages from '../../resources/lang/en/messages.json'
import zhTWMessages from '../../resources/lang/zh-TW/messages.json'
import shellEnMessages from '../../resources/lang/en/shell.json'
import shellZhTWMessages from '../../resources/lang/zh-TW/shell.json'
import ceremonyEnMessages from '../../resources/lang/en/ceremony.json'
import ceremonyZhTWMessages from '../../resources/lang/zh-TW/ceremony.json'

export interface Messages {
  [key: string]: unknown
}

const BUNDLED_MESSAGES: Record<string, Messages> = {
  en: { ...(enMessages as Messages), shell: shellEnMessages, ceremony: ceremonyEnMessages },
  'zh-TW': {
    ...(zhTWMessages as Messages),
    shell: shellZhTWMessages,
    ceremony: ceremonyZhTWMessages,
  },
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
        value = (value as Messages)[part] as Messages | string | undefined
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
        value = (value as Messages)[part] as Messages | string | undefined
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
   * Switch the catalogue this loader reads.
   *
   * `DBCLI_LANG` is read once, in the constructor, and the module-level `t` /
   * `t_vars` close over one instance — so replacing the singleton does not
   * reach them. Anything that needs a different language after start-up needs
   * this. Today that is the test suite, which asserts on English wording to
   * establish *which* refusal fired and must do so whatever `DBCLI_LANG` the
   * run inherited.
   */
  setLanguage(lang: string): void {
    this.currentLang = lang
    this.messages = {}
    this.loadMessages()
  }

  /**
   * Interpolate variables in a message.
   * Replaces {varName} with values from vars object.
   * Supports multiple variables.
   */
  interpolate(key: string, vars: Record<string, string | number>): string {
    // One pass over the message, with a replacer *function*.
    //
    // Two defects the previous shape had, both reachable from values a user
    // controls — an Elasticsearch shell refusal interpolates the path the
    // operator typed, the index expression that matched and the field name that
    // was refused, and the same string becomes the audit row's `error`:
    //
    // 1. `String.replace(re, value)` honours `$&`, `$'`, `` $` `` and `$1` in
    //    the *replacement*, so a value containing them rewrote the message
    //    around itself. `sec$&rets` came out as `sec{index}rets`, which named
    //    an index nobody asked for, in the record of what was refused.
    // 2. Variables were substituted one at a time, so a value that happened to
    //    spell another variable's placeholder was substituted again by the
    //    next pass.
    //
    // A replacer function receives the name and returns the value verbatim, and
    // a single pass never revisits what it has written. An unknown placeholder
    // is left as it was found, which is what the per-variable loop did.
    return this.t(key).replace(/\{([^{}]+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    )
  }
}

// Export singleton instance
export const messageLoader = MessageLoader.getInstance()

// Export convenience functions
export const t = (key: string): string => messageLoader.t(key)

export const t_vars = (key: string, vars: Record<string, string | number>): string =>
  messageLoader.interpolate(key, vars)

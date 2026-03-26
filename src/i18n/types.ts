/**
 * i18n Type Definitions
 * Provides interfaces for message system and i18n options.
 */

/**
 * Messages structure: supports nested or flat key-value pairs.
 * Typically loaded from JSON files like resources/lang/en/messages.json
 */
export interface Messages {
  [key: string]: any
}

/**
 * Options for MessageLoader configuration.
 * Supports future extensibility (e.g., pluralization rules, formatting options).
 */
export interface MessageLoaderOptions {
  lang?: string
  fallbackLang?: string
}

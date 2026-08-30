/**
 * Pin the message catalogue to English for the importing test file.
 *
 * A test that asserts on a refusal's wording is asserting *which* refusal
 * happened — that is what nine rounds of review on the Elasticsearch shell were
 * checking, and "it threw something" would not have caught any of them. Those
 * assertions are written against the English catalogue, so they need the
 * English catalogue, whatever `DBCLI_LANG` the run inherited.
 *
 * Pinning here rather than rewriting the assertions against message *keys* is
 * deliberate: an assertion that looks the expected text up the same way the
 * code does can never disagree with the code. The English literal is an
 * independent source of truth; `t('shell.es.blacklist_field')` is not.
 *
 * Key and translation parity for the same messages is covered separately, in
 * `tests/unit/i18n/es-shell-messages.test.ts`.
 *
 * The loader reads `DBCLI_LANG` once, in its constructor, and the module-level
 * `t` / `t_vars` close over one instance — so replacing the singleton does not
 * reach them. `setLanguage` does. Bun shares one process across test files, so
 * the previous language is put back when the file finishes.
 */
import { beforeAll, afterAll } from 'bun:test'
import { messageLoader } from '@/i18n/message-loader'

export function pinEnglishMessages(): void {
  const previousLang = Bun.env.DBCLI_LANG ?? 'en'

  beforeAll(() => {
    messageLoader.setLanguage('en')
  })

  afterAll(() => {
    messageLoader.setLanguage(previousLang)
  })
}

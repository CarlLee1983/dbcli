import { afterAll, expect, test } from 'bun:test'
import { messageLoader, t } from '@/i18n/message-loader'

const previousLang = Bun.env.DBCLI_LANG ?? 'en'
afterAll(() => messageLoader.setLanguage(previousLang))

const diagnostics = [
  ['sql_tls_driver_identity', 'identity verification is unavailable', '無法執行 SQL TLS 身分驗證'],
  ['sql_tls_peer_unverified', 'peer is not authenticated', '對端尚未通過驗證'],
  ['sql_tls_peer_missing', 'peer certificate is unavailable', '無法取得 SQL TLS 對端憑證'],
  ['sql_tls_recovery_config', '--config <path> or --global', '--config <path> 或 --global'],
  [
    'sql_tls_recovery_profile',
    '--use <name> (or DBCLI_CONNECTION)',
    '--use <name>（或 DBCLI_CONNECTION）',
  ],
  ['sql_tls_recovery_required', 'plaintext recovery is refused', '拒絕明文復原'],
  [
    'sql_tls_recovery_target',
    'explicitly selected, verified TLS profile',
    '明確選取已設定驗證式 TLS 的 profile',
  ],
] as const

test.each(['en', 'zh-TW'] as const)(
  'TLS guard and recovery diagnostics render in %s',
  (language) => {
    messageLoader.setLanguage(language)
    for (const [key, english, chinese] of diagnostics) {
      const message = t(`errors.${key}`)
      expect(message).toContain(language === 'en' ? english : chinese)
      expect(message).not.toContain(`errors.${key}`)
    }
    expect(t('errors.sql_tls_recovery_required')).toContain('sqlTls verify-full')
  }
)

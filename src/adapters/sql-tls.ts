import { X509Certificate } from 'node:crypto'
import { t, t_vars } from '@/i18n/message-loader'
import { SqlTlsConfigSchema } from '@/utils/validation'
import { ConnectionError, type ConnectionOptions } from './types'

/** Reload each profile's trust before dialing; never cache CA or inherit ambient trust. */
export async function sqlTlsCa(options: ConnectionOptions): Promise<string | undefined> {
  if (options.sqlTls === undefined) return undefined
  const config = SqlTlsConfigSchema.parse(options.sqlTls)
  if (!options.host || options.host.startsWith('/')) {
    throw new ConnectionError('TLS_ERROR', t('errors.sql_tls_network_host'), [])
  }
  try {
    const ca = await Bun.file(config.caPath).text()
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    if (!certificates?.length) throw new Error(t('errors.sql_tls_ca_empty'))
    for (const pem of certificates) new X509Certificate(pem)
    return ca
  } catch (cause) {
    throw new ConnectionError(
      'TLS_ERROR',
      t_vars('errors.sql_tls_ca_load', {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
      [t('errors.sql_tls_ca_restore')]
    )
  }
}

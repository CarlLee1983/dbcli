import { t, t_vars } from '@/i18n/message-loader'
import { isIP } from 'node:net'
import { X509Certificate } from 'node:crypto'
import { checkServerIdentity, type ConnectionOptions as TlsOptions } from 'node:tls'
import { SqlTlsConfigSchema } from '@/utils/validation'
import type { ConnectionOptions } from './types'
import { ConnectionError } from './types'

/** Per-profile trust: never inherit ambient verification settings or cache another profile's CA. */
export async function postgresqlTlsOptions(
  options: ConnectionOptions
): Promise<TlsOptions | undefined> {
  if (options.sqlTls === undefined) return undefined
  const config = SqlTlsConfigSchema.parse(options.sqlTls)
  if (!options.host || options.host.startsWith('/')) {
    throw new ConnectionError('TLS_ERROR', t('errors.sql_tls_network_host'), [])
  }
  let ca: string
  try {
    ca = await Bun.file(config.caPath).text()
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    if (!certificates?.length) throw new Error(t('errors.sql_tls_ca_empty'))
    for (const pem of certificates) new X509Certificate(pem)
  } catch (cause) {
    throw new ConnectionError(
      'TLS_ERROR',
      t_vars('errors.sql_tls_ca_load', {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
      [t('errors.sql_tls_ca_restore')]
    )
  }
  return {
    ca,
    rejectUnauthorized: true,
    // SNI is a DNS name. The identity callback pins DNS/IP verification independently.
    ...(isIP(options.host) === 0 && { servername: options.host }),
    checkServerIdentity: (_hostname, certificate) => checkServerIdentity(options.host, certificate),
  }
}

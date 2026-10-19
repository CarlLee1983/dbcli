import { isIP } from 'node:net'
import { checkServerIdentity, type ConnectionOptions as TlsOptions } from 'node:tls'
import type { ConnectionOptions } from './types'
import { sqlTlsCa } from './sql-tls'

/** Per-profile trust: never inherit ambient verification settings or cache another profile's CA. */
export async function postgresqlTlsOptions(
  options: ConnectionOptions
): Promise<TlsOptions | undefined> {
  const ca = await sqlTlsCa(options)
  if (ca === undefined) return undefined
  return {
    ca,
    rejectUnauthorized: true,
    // SNI is a DNS name. The identity callback pins DNS/IP verification independently.
    ...(isIP(options.host) === 0 && { servername: options.host }),
    checkServerIdentity: (_hostname, certificate) => checkServerIdentity(options.host, certificate),
  }
}

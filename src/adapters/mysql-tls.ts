import { checkServerIdentity, TLSSocket } from 'node:tls'
import type { Connection, ConnectionOptions } from 'mysql2'
import type { Connection as PromiseConnection } from 'mysql2/promise'
import { ConnectionError } from './types'
import { t } from '@/i18n/message-loader'

// mysql2's private upgrade callback is the last boundary before it sends credentials.
// Keep this dependency confined here and cover it with real pre-authentication failures.
interface TlsConnection extends Connection {
  startTLS(onSecure: (error?: Error) => void): void
  stream: TLSSocket
}

export async function connectVerifiedMysql(
  options: ConnectionOptions,
  ca: string,
  host: string
): Promise<PromiseConnection> {
  const { default: driver } = await import('mysql2')
  const connection = driver.createConnection({
    ...options,
    ssl: {
      ca,
      rejectUnauthorized: true,
      // mysql2 ignores custom identity callbacks and omits IP SNI. Its optional
      // DNS-only check is replaced by the mandatory DNS/IP guard below, not bypassed.
      verifyIdentity: false,
    },
  }) as TlsConnection
  guardMysqlIdentity(connection, host)
  return new Promise((resolve, reject) => {
    connection.connect((error) => {
      if (error) {
        connection.destroy()
        reject(error)
      } else {
        resolve(connection.promise())
      }
    })
  })
}

function guardMysqlIdentity(connection: TlsConnection, host: string): void {
  const startTLS = connection.startTLS
  if (typeof startTLS !== 'function') {
    connection.destroy()
    throw new ConnectionError('TLS_ERROR', t('errors.sql_tls_driver_identity'), [])
  }
  // Installed synchronously before any network data can trigger the handshake.
  connection.startTLS = (onSecure) => {
    let completed = false
    startTLS.call(connection, (error) => {
      if (completed) return
      completed = true
      let failure = error
      if (!failure) {
        try {
          const socket = connection.stream
          if (!(socket instanceof TLSSocket) || !socket.encrypted || !socket.authorized) {
            throw new Error(t('errors.sql_tls_peer_unverified'))
          }
          const certificate = socket.getPeerCertificate(true)
          if (!certificate.raw?.length) throw new Error(t('errors.sql_tls_peer_missing'))
          failure = checkServerIdentity(host, certificate)
        } catch (cause) {
          failure = cause instanceof Error ? cause : new Error(String(cause))
        }
      }
      onSecure(failure)
      if (failure) connection.destroy()
    })
  }
}

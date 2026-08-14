/**
 * dbcli password — 只改一條連線的密碼，其他設定原封不動。
 *
 * 給密碼會自動輪替的環境用：新密碼預設先連一次驗證通過才落盤，
 * 避免把壞掉的憑證寫進設定。
 */

import { Command } from 'commander'
import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import { configModule } from '@/core/config'
import { assertConfigMutationApproved } from '@/core/config-mutation-guard'
import { resolveConfigStoragePath } from '@/core/config-binding'
import { resolvePasswordTarget, setConnectionPassword } from '@/core/connection-credential'
import type { PasswordTarget } from '@/core/connection-credential'
import { resolveConfigPath } from '@/utils/config-path'
import { promptUser } from '@/utils/prompts'
import { ConfigError } from '@/utils/errors'
import { t, t_vars } from '@/i18n/message-loader'

export interface PasswordInputOptions {
  password?: string
  stdin?: boolean
}

export interface PasswordInputIO {
  isTTY: boolean
  readStdin: () => Promise<string>
  prompt: () => Promise<string>
}

async function readAllStdin(): Promise<string> {
  return await Bun.stdin.text()
}

/**
 * 解析新密碼的來源：--password / --stdin / 互動遮蔽輸入，三者擇一。
 *
 * 只砍掉 stdin 尾端的換行——密碼前後的空白可能是真的，不能 trim。
 */
export async function resolveNewPassword(
  options: PasswordInputOptions,
  io: PasswordInputIO
): Promise<string> {
  if (options.password !== undefined && options.stdin) {
    throw new ConfigError(t('password.source_conflict'))
  }

  let value: string
  if (options.password !== undefined) {
    value = options.password
  } else if (options.stdin) {
    value = (await io.readStdin()).replace(/\r?\n$/, '')
  } else if (io.isTTY) {
    value = await io.prompt()
  } else {
    throw new ConfigError(t('password.needs_source'))
  }

  if (value.length === 0) {
    throw new ConfigError(t('password.empty'))
  }
  return value
}

/**
 * 用新密碼實際連一次。config 其餘欄位照常解析，只把密碼換成待驗證的值。
 */
async function verifyNewPassword(
  configPath: string,
  target: PasswordTarget,
  connectionName: string | undefined,
  password: string
): Promise<void> {
  const storagePath = await resolveConfigStoragePath(configPath)
  // 舊密碼的 env var 此刻可能已經失效或根本沒設；先注入新值，
  // config 的 $env 解析才不會在驗證前就爆掉。用完還原，別讓待驗證的密碼
  // 外洩到後續 spawn 的子行程。
  const previous = process.env[target.varName]
  process.env[target.varName] = password

  try {
    const config = await configModule.read(storagePath, connectionName)
    const adapter = AdapterFactory.createAdapter({
      ...(config.connection as ConnectionOptions),
      password,
    })

    try {
      await adapter.connect()
      await adapter.testConnection()
    } finally {
      await adapter.disconnect().catch(() => undefined)
    }
  } finally {
    if (previous === undefined) delete process.env[target.varName]
    else process.env[target.varName] = previous
  }
}

export const passwordCommand = new Command('password')
  .description(t('password.description'))
  .argument('[connection]', t('password.arg_connection'))
  .option('--stdin', t('password.opt_stdin'))
  .option('--password <value>', t('password.opt_password'))
  .option('--skip-test', t('password.opt_skip_test'))
  .option('--format <format>', 'Output format (text, json)', 'text')
  .action(async (connection: string | undefined, options: Record<string, unknown>) => {
    try {
      // 先擋 agent mode：不然會先要使用者輸入密碼、再連一次資料庫，
      // 最後才拒絕。
      assertConfigMutationApproved()

      const configPath = resolveConfigPath(passwordCommand)
      const target = await resolvePasswordTarget(configPath, connection)

      const value = await resolveNewPassword(
        {
          password: typeof options.password === 'string' ? options.password : undefined,
          stdin: options.stdin === true,
        },
        {
          isTTY: Boolean(process.stdin.isTTY),
          readStdin: readAllStdin,
          prompt: () => promptUser.secret(t_vars('password.prompt', { name: target.connection })),
        }
      )

      if (options.skipTest !== true) {
        await verifyNewPassword(configPath, target, connection, value)
      }

      const written = await setConnectionPassword(configPath, connection, value)

      if (options.format === 'json') {
        console.log(JSON.stringify({ success: true, ...written }, null, 2))
      } else {
        console.log(
          t_vars('password.updated', {
            name: written.connection,
            envFile: written.envFile,
            varName: written.varName,
          })
        )
        if (written.convertedToEnvRef) {
          console.log(t_vars('password.converted', { varName: written.varName }))
        }
        if (options.skipTest === true) {
          console.log(t('password.skipped_test'))
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 輪替腳本用 --format json 時，失敗原因也必須是可解析的。
      if (options.format === 'json') {
        console.error(JSON.stringify({ success: false, error: message }, null, 2))
      } else {
        console.error(t_vars('errors.message', { message }))
      }
      process.exit(1)
    }
  })

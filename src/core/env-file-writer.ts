/**
 * env 檔的單一 key 就地更新：既有同名 key 覆寫，否則追加，其餘內容與註解保留。
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * env 檔裝的是密碼，一律鎖成只有擁有者可讀寫。
 *
 * POSIX 才有這個保證：Windows 沒有對應的 mode 位元，chmod 只切換唯讀旗標，
 * 實際權限由所在目錄的 ACL 決定。
 */
const SECRET_FILE_MODE = 0o600

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function upsertEnvVar(envPath: string, varName: string, value: string): Promise<void> {
  let content = ''
  try {
    content = await readFile(envPath, 'utf8')
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw cause
    await mkdir(dirname(envPath), { recursive: true })
  }

  // 一律加引號:讀取端會先 trim 整行再剝掉一層對稱引號,不加引號的話
  // 密碼首尾的空白會被吃掉。剝掉的是「一層」,所以本身就以引號開頭結尾的值
  // 也能原樣還原。
  const line = `${varName}="${value}"`
  const existing = new RegExp(`^${escapeForRegExp(varName)}=.*$`, 'm')
  if (existing.test(content)) {
    // replacer 用 function:字串形式會把密碼裡的 $&、$1 當成替換樣式展開,
    // 靜默把密碼寫成別的值。
    content = content.replace(existing, () => line)
  } else {
    content =
      content.length && !content.endsWith('\n') ? `${content}\n${line}\n` : `${content}${line}\n`
  }

  await writeFile(envPath, content, { mode: SECRET_FILE_MODE })
  await chmod(envPath, SECRET_FILE_MODE)
}

/**
 * Shell 的提交佇列——序列化，而且退出前要排乾。
 *
 * 第五輪對抗式複查的 CRITICAL：`printf 'DELETE /orders\n\n' | dbcli shell` 會
 * 送出請求卻不寫任何 audit。readline 不 await `'line'` handler，handler 在第一個
 * await 就讓出，EOF 的 `'close'` 隨即 `process.exit(0)`——此時請求還在飛，audit
 * 還沒開始寫。權限與 blacklist 都在送出前同步跑完，所以檢查會通過、封包會出去，
 * 唯一沒發生的就是稽核。
 *
 * SQL shell 已經有序列化那一半（`shell.ts` 的 `pending` 鏈），缺的是同一個
 * `'close'` 沒有排乾。兩邊共用這一個佇列，兩半都在裡面。
 */

import { describe, test, expect } from 'bun:test'
import { createSubmitQueue } from 'src/commands/shell-submit-queue'

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('createSubmitQueue', () => {
  test('任務依序執行，不併發', async () => {
    const queue = createSubmitQueue()
    const order: string[] = []

    queue.enqueue(async () => {
      order.push('a:start')
      await tick(20)
      order.push('a:end')
    })
    queue.enqueue(async () => {
      order.push('b:start')
      await tick(0)
      order.push('b:end')
    })

    await queue.drain()
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  test('drain 等到所有任務真的做完——這是 audit 沒被寫出的那一半', async () => {
    const queue = createSubmitQueue()
    const audited: string[] = []

    for (const target of ['/a', '/b', '/c']) {
      queue.enqueue(async () => {
        await tick(10)
        audited.push(target)
      })
    }

    expect(audited).toEqual([])
    await queue.drain()
    expect(audited).toEqual(['/a', '/b', '/c'])
  })

  test('某個任務丟出例外不會吃掉後續任務，drain 仍然完成', async () => {
    const queue = createSubmitQueue()
    const done: string[] = []

    queue.enqueue(async () => {
      throw new Error('boom')
    })
    queue.enqueue(async () => {
      await tick(0)
      done.push('after')
    })

    await queue.drain()
    expect(done).toEqual(['after'])
  })

  test('drain 之後仍可繼續 enqueue 並再次 drain', async () => {
    const queue = createSubmitQueue()
    const done: string[] = []

    queue.enqueue(async () => {
      done.push('first')
    })
    await queue.drain()

    queue.enqueue(async () => {
      await tick(5)
      done.push('second')
    })
    await queue.drain()

    expect(done).toEqual(['first', 'second'])
  })

  test('drain 期間新加入的任務也要被等到', async () => {
    const queue = createSubmitQueue()
    const done: string[] = []

    queue.enqueue(async () => {
      await tick(5)
      done.push('outer')
      queue.enqueue(async () => {
        await tick(5)
        done.push('inner')
      })
    })

    await queue.drain()
    expect(done).toEqual(['outer', 'inner'])
  })

  test('空佇列的 drain 立刻完成', async () => {
    await expect(createSubmitQueue().drain()).resolves.toBeUndefined()
  })
})

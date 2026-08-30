/**
 * Shell 的提交佇列：序列化，並且能被排乾。
 *
 * readline 不會 await `'line'` handler。handler 在第一個 `await` 就讓出，於是
 * 兩件事同時成立：同一批送達的行會併發跑進共用狀態，而 EOF 的 `'close'` 會在
 * 它們完成之前就 `process.exit()`。第二件事在有 audit 的 shell 上是稽核逃逸，
 * 不只是遺失輸出——權限與 blacklist 都在送出前同步跑完，所以檢查通過、封包出去，
 * 唯一沒發生的是紀錄。
 *
 * 兩半必須在同一個地方：只序列化不排乾，退出時仍會丟掉最後一筆；只排乾不序列化，
 * 併發的 handler 仍共用彼此的多行緩衝。
 */
export interface SubmitQueue {
  /** 排入一個任務，接在目前佇列尾端執行。任務丟出的例外不會影響後續任務。 */
  enqueue(task: () => Promise<void>): void
  /** 等到佇列排空為止，包含排乾期間新加入的任務。 */
  drain(): Promise<void>
}

export function createSubmitQueue(): SubmitQueue {
  let tail: Promise<void> = Promise.resolve()

  const enqueue = (task: () => Promise<void>): void => {
    // 例外在這裡吞掉，是因為佇列不是任務結果的收件人：呼叫端自己有 try/catch
    // 把錯誤印給使用者。若讓它傳下去，一個失敗的語句會讓整條鏈進入 rejected
    // 狀態，之後每一筆都被跳過——那正是這個佇列要防的失敗模式的另一面。
    tail = tail.then(task).catch(() => {})
  }

  const drain = async (): Promise<void> => {
    // 迴圈而非單次 await：任務自己可能再 enqueue（互動指令觸發後續動作），
    // 那些也算在「排空」裡。tail 不再變動就代表真的空了。
    let seen: Promise<void> | undefined
    while (seen !== tail) {
      seen = tail
      await seen
    }
  }

  return { enqueue, drain }
}

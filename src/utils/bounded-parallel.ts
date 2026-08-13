/**
 * 有界並行 map。
 *
 * 逐一 await 的迴圈在「每項都是一次網路往返」時把總時間變成往返次數乘以延遲；
 * 全部一起送則會在百張表的資料庫上同時開上百個查詢。上限讓兩者都不發生。
 * 結果順序與輸入一致——呼叫端不必為了並行改變它讀結果的方式。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const effectiveLimit = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let next = 0

  async function run(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, run))
  return results
}

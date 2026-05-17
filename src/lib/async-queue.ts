export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        results[currentIndex] = await mapper(items[currentIndex], currentIndex)
      }
    })
  )

  return results
}

export function createAsyncLimiter(concurrency: number) {
  const safeConcurrency = Math.max(1, concurrency)
  let active = 0
  const queue: Array<() => void> = []

  return async function runLimited<T>(task: () => Promise<T>) {
    if (active >= safeConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }

    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      queue.shift()?.()
    }
  }
}

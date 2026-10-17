// A small work queue: at most `limit` tasks run at once, the others wait. The newest waiting task goes first by default,
// because the newest request belongs to what the person sees right now (the bird cards that just scrolled into view).

export interface LimiterOptions {
  /** Which waiting task starts next when a place frees up. Default 'newest'. */
  order?: 'newest' | 'oldest'
}

export interface Limiter {
  /** Runs `task` when there is a free place. The promise settles with the task's result. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Tasks running right now. */
  readonly active: number
  /** Tasks waiting for a place. */
  readonly waiting: number
}

export function createLimiter(limit: number, options: LimiterOptions = {}): Limiter {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('The limit must be a whole number of at least 1')
  const newestFirst = (options.order ?? 'newest') === 'newest'
  const queue: Array<() => void> = []
  let active = 0

  const startNext = () => {
    while (active < limit && queue.length > 0) {
      const start = newestFirst ? queue.pop() : queue.shift()
      start?.()
    }
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          active += 1
          // `task` may also throw before it returns a promise.
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              active -= 1
              startNext()
            })
        })
        startNext()
      })
    },
    get active() {
      return active
    },
    get waiting() {
      return queue.length
    },
  }
}

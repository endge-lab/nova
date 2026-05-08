export interface NovaRenderScheduledTask {
  id: string
  run: () => void
}

export interface NovaRenderSchedulerResult {
  executed: number
  remaining: number
  elapsedMs: number
}

export class NovaRenderScheduler {
  private readonly _queue: NovaRenderScheduledTask[] = []

  enqueue(task: NovaRenderScheduledTask): void {
    this._queue.push(task)
  }

  runBudgeted(budgetMs: number): NovaRenderSchedulerResult {
    const startedAt = performance.now()
    let executed = 0

    while (this._queue.length > 0) {
      if (performance.now() - startedAt >= budgetMs) break
      const task = this._queue.shift()!
      task.run()
      executed += 1
    }

    return {
      executed,
      remaining: this._queue.length,
      elapsedMs: performance.now() - startedAt,
    }
  }

  clear(): void {
    this._queue.length = 0
  }
}

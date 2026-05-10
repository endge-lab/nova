/**
 * Описывает контракт NovaRenderScheduledTask.
 */
export interface NovaRenderScheduledTask {
  id: string
  run: () => void
}

/**
 * Описывает контракт NovaRenderSchedulerResult.
 */
export interface NovaRenderSchedulerResult {
  executed: number
  remaining: number
  elapsedMs: number
}

/**
 * Планирует ограниченные по бюджету render/resource задачи.
 */
export class NovaRenderScheduler {
  private readonly _queue: NovaRenderScheduledTask[] = []

  /**
   * Выполняет внутреннюю операцию enqueue.
   */
  enqueue(task: NovaRenderScheduledTask): void {
    this._queue.push(task)
  }

  /**
   * Выполняет внутреннюю операцию run budgeted.
   */
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

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._queue.length = 0
  }
}

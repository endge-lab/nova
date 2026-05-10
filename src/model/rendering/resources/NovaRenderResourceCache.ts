/**
 * Хранит generic render resources с LRU-подобным доступом.
 */
export class NovaRenderResourceCache<T> {
  private readonly _cache = new Map<string, T>()

  /**
   * Возвращает size.
   */
  get size(): number {
    return this._cache.size
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get(key: string): T | undefined {
    return this._cache.get(key)
  }

  /**
   * Выполняет внутреннюю операцию set.
   */
  set(key: string, value: T): T {
    this._cache.set(key, value)
    return value
  }

  /**
   * Возвращает or create.
   */
  getOrCreate(key: string, factory: () => T): T {
    const current = this._cache.get(key)
    if (current !== undefined) return current

    const next = factory()
    this._cache.set(key, next)
    return next
  }

  /**
   * Выполняет внутреннюю операцию delete.
   */
  delete(key: string): boolean {
    return this._cache.delete(key)
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._cache.clear()
  }
}

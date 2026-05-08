export class NovaRenderResourceCache<T> {
  private readonly _cache = new Map<string, T>()

  get size(): number {
    return this._cache.size
  }

  get(key: string): T | undefined {
    return this._cache.get(key)
  }

  set(key: string, value: T): T {
    this._cache.set(key, value)
    return value
  }

  getOrCreate(key: string, factory: () => T): T {
    const current = this._cache.get(key)
    if (current !== undefined) return current

    const next = factory()
    this._cache.set(key, next)
    return next
  }

  delete(key: string): boolean {
    return this._cache.delete(key)
  }

  clear(): void {
    this._cache.clear()
  }
}

export interface NovaTextureAtlasEntry<T = unknown> {
  id: string
  key: string
  width: number
  height: number
  scale: number
  bytes: number
  payload?: T
  lastUsed: number
}

export interface NovaTextureAtlasManagerOptions {
  maxMemoryMB: number
}

export class NovaTextureAtlasManager<T = unknown> {
  private readonly _entries = new Map<string, NovaTextureAtlasEntry<T>>()
  private _bytes = 0
  private _tick = 0

  constructor(private readonly _options: NovaTextureAtlasManagerOptions) {}

  get memoryBytes(): number {
    return this._bytes
  }

  get memoryMB(): number {
    return this._bytes / 1024 / 1024
  }

  get entries(): NovaTextureAtlasEntry<T>[] {
    return [...this._entries.values()]
  }

  get(key: string): NovaTextureAtlasEntry<T> | undefined {
    const entry = this._entries.get(key)
    if (entry) entry.lastUsed = ++this._tick
    return entry
  }

  set(entry: Omit<NovaTextureAtlasEntry<T>, 'lastUsed' | 'bytes'> & { bytes?: number }): NovaTextureAtlasEntry<T> {
    const current = this._entries.get(entry.key)
    if (current) {
      this._bytes -= current.bytes
    }

    const next: NovaTextureAtlasEntry<T> = {
      ...entry,
      bytes: entry.bytes ?? Math.ceil(entry.width * entry.height * 4),
      lastUsed: ++this._tick,
    }

    this._entries.set(next.key, next)
    this._bytes += next.bytes
    this.evictToBudget()
    return next
  }

  evictToBudget(): NovaTextureAtlasEntry<T>[] {
    const evicted: NovaTextureAtlasEntry<T>[] = []
    const budgetBytes = this._options.maxMemoryMB * 1024 * 1024
    if (this._bytes <= budgetBytes) return evicted

    const candidates = [...this._entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const entry of candidates) {
      if (this._bytes <= budgetBytes) break
      this._entries.delete(entry.key)
      this._bytes -= entry.bytes
      evicted.push(entry)
    }

    return evicted
  }

  clear(): void {
    this._entries.clear()
    this._bytes = 0
  }
}

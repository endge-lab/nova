export interface NovaTextureAtlasEntry<T = unknown> {
  id: string
  key: string
  width: number
  height: number
  scale: number
  bytes: number
  pageId?: string
  x?: number
  y?: number
  payload?: T
  lastUsed: number
}

export interface NovaTextureAtlasManagerOptions {
  maxMemoryMB: number
  pageSize?: number
}

export interface NovaTextureAtlasPage {
  id: string
  width: number
  height: number
  cursorX: number
  cursorY: number
  rowHeight: number
  entries: Set<string>
}

export class NovaTextureAtlasManager<T = unknown> {
  private readonly _entries = new Map<string, NovaTextureAtlasEntry<T>>()
  private readonly _pages: NovaTextureAtlasPage[] = []
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

  get pages(): NovaTextureAtlasPage[] {
    return this._pages.map(page => ({
      ...page,
      entries: new Set(page.entries),
    }))
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
      this.removeFromPage(current)
    }

    const region = this.allocateRegion(entry.width, entry.height)
    const next: NovaTextureAtlasEntry<T> = {
      ...entry,
      bytes: entry.bytes ?? Math.ceil(entry.width * entry.height * 4),
      pageId: region.page.id,
      x: region.x,
      y: region.y,
      lastUsed: ++this._tick,
    }

    this._entries.set(next.key, next)
    region.page.entries.add(next.key)
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
      this.removeFromPage(entry)
      evicted.push(entry)
    }

    return evicted
  }

  clear(): void {
    this._entries.clear()
    this._pages.length = 0
    this._bytes = 0
  }

  private allocateRegion(width: number, height: number): { page: NovaTextureAtlasPage; x: number; y: number } {
    const pageSize = this._options.pageSize ?? 2048
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))

    for (const page of this._pages) {
      const region = this.tryAllocateOnPage(page, w, h)
      if (region) return region
    }

    const page: NovaTextureAtlasPage = {
      id: `atlas-page:${this._pages.length + 1}`,
      width: Math.max(pageSize, w),
      height: Math.max(pageSize, h),
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      entries: new Set(),
    }
    this._pages.push(page)
    return this.tryAllocateOnPage(page, w, h)!
  }

  private tryAllocateOnPage(page: NovaTextureAtlasPage, width: number, height: number): { page: NovaTextureAtlasPage; x: number; y: number } | null {
    if (width > page.width || height > page.height) return null

    if (page.cursorX + width > page.width) {
      page.cursorX = 0
      page.cursorY += page.rowHeight
      page.rowHeight = 0
    }

    if (page.cursorY + height > page.height) return null

    const x = page.cursorX
    const y = page.cursorY
    page.cursorX += width
    page.rowHeight = Math.max(page.rowHeight, height)
    return { page, x, y }
  }

  private removeFromPage(entry: NovaTextureAtlasEntry<T>): void {
    if (!entry.pageId) return
    const page = this._pages.find(item => item.id === entry.pageId)
    page?.entries.delete(entry.key)
  }
}

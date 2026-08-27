/**
 * Описывает контракт NovaTextureAtlasEntry.
 */
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

/**
 * Описывает контракт NovaTextureAtlasManagerOptions.
 */
export interface NovaTextureAtlasManagerOptions {
  maxMemoryMB: number
  pageSize?: number
}

/**
 * Описывает контракт NovaTextureAtlasPage.
 */
export interface NovaTextureAtlasPage {
  id: string
  width: number
  height: number
  cursorX: number
  cursorY: number
  rowHeight: number
  entries: Set<string>
}

/**
 * Кэширует texture regions и управляет atlas entries для image/icon resources.
 */
export class NovaTextureAtlasManager<T = unknown> {
  private readonly _entries = new Map<string, NovaTextureAtlasEntry<T>>()
  private readonly _pages: Array<NovaTextureAtlasPage> = []
  private _bytes = 0
  private _tick = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(private readonly _options: NovaTextureAtlasManagerOptions) {}

  /**
   * Возвращает memory bytes.
   */
  get memoryBytes(): number {
    return this._bytes
  }

  /**
   * Возвращает memory mb.
   */
  get memoryMB(): number {
    return this._bytes / 1024 / 1024
  }

  /**
   * Возвращает entries.
   */
  get entries(): Array<NovaTextureAtlasEntry<T>> {
    return [...this._entries.values()]
  }

  /**
   * Возвращает pages.
   */
  get pages(): Array<NovaTextureAtlasPage> {
    return this._pages.map(page => ({
      ...page,
      entries: new Set(page.entries),
    }))
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get(key: string): NovaTextureAtlasEntry<T> | undefined {
    const entry = this._entries.get(key)
    if (entry) {
      entry.lastUsed = ++this._tick
    }
    return entry
  }

  /**
   * Выполняет внутреннюю операцию set.
   */
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

  /**
   * Выполняет внутреннюю операцию evict to budget.
   */
  evictToBudget(): Array<NovaTextureAtlasEntry<T>> {
    const evicted: Array<NovaTextureAtlasEntry<T>> = []
    const budgetBytes = this._options.maxMemoryMB * 1024 * 1024
    if (this._bytes <= budgetBytes) {
      return evicted
    }

    const candidates = [...this._entries.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const entry of candidates) {
      if (this._bytes <= budgetBytes) {
        break
      }
      this._entries.delete(entry.key)
      this._bytes -= entry.bytes
      this.removeFromPage(entry)
      evicted.push(entry)
    }

    return evicted
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._entries.clear()
    this._pages.length = 0
    this._bytes = 0
  }

  /**
   * Выполняет внутреннюю операцию allocate region.
   */
  private allocateRegion(width: number, height: number): { page: NovaTextureAtlasPage, x: number, y: number } {
    const pageSize = this._options.pageSize ?? 2048
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))

    for (const page of this._pages) {
      const region = this.tryAllocateOnPage(page, w, h)
      if (region) {
        return region
      }
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

  /**
   * Выполняет внутреннюю операцию try allocate on page.
   */
  private tryAllocateOnPage(page: NovaTextureAtlasPage, width: number, height: number): { page: NovaTextureAtlasPage, x: number, y: number } | null {
    if (width > page.width || height > page.height) {
      return null
    }

    if (page.cursorX + width > page.width) {
      page.cursorX = 0
      page.cursorY += page.rowHeight
      page.rowHeight = 0
    }

    if (page.cursorY + height > page.height) {
      return null
    }

    const x = page.cursorX
    const y = page.cursorY
    page.cursorX += width
    page.rowHeight = Math.max(page.rowHeight, height)
    return { page, x, y }
  }

  /**
   * Удаляет from page.
   */
  private removeFromPage(entry: NovaTextureAtlasEntry<T>): void {
    if (!entry.pageId) {
      return
    }
    const page = this._pages.find(item => item.id === entry.pageId)
    page?.entries.delete(entry.key)
  }
}

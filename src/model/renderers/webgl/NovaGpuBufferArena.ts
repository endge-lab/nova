/**
 * Описывает контракт NovaGpuDirtyByteRange.
 */
export interface NovaGpuDirtyByteRange {
  start: number
  end: number
}

/**
 * Описывает контракт NovaGpuBufferSlot.
 */
export interface NovaGpuBufferSlot {
  index: number
  byteOffset: number
  byteLength: number
}

/**
 * Управляет persistent GPU buffer capacity, dirty ranges и upload policy.
 */
export class NovaGpuBufferArena {
  private _capacityBytes = 0
  private _slotByteLength = 0
  private _nextSlotIndex = 0
  private _nextByteOffset = 0
  private readonly _freeSlots: NovaGpuBufferSlot[] = []
  private readonly _dirtyRanges: NovaGpuDirtyByteRange[] = []

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _fullUploadDirtyRatio = 0.6,
    private readonly _mergeGapBytes = 256,
  ) {}

  /**
   * Возвращает capacity bytes.
   */
  get capacityBytes(): number {
    return this._capacityBytes
  }

  /**
   * Возвращает allocated slots.
   */
  get allocatedSlots(): number {
    return this._nextSlotIndex - this._freeSlots.length
  }

  /**
   * Выполняет внутреннюю операцию configure slot byte length.
   */
  configureSlotByteLength(byteLength: number): void {
    if (byteLength <= 0) return
    this._slotByteLength = byteLength
  }

  /**
   * Выполняет внутреннюю операцию ensure capacity.
   */
  ensureCapacity(byteLength: number): boolean {
    if (byteLength <= this._capacityBytes) return false

    this._capacityBytes = Math.max(byteLength, this._capacityBytes * 2)
    return true
  }

  /**
   * Выполняет внутреннюю операцию allocate slot.
   */
  allocateSlot(byteLength: number = this._slotByteLength): NovaGpuBufferSlot {
    if (byteLength <= 0) {
      throw new Error('NovaGpuBufferArena.allocateSlot() requires a positive byteLength.')
    }

    const reusableIndex = this._freeSlots.findIndex(slot => slot.byteLength === byteLength)
    if (reusableIndex >= 0) {
      const [slot] = this._freeSlots.splice(reusableIndex, 1)
      this.markDirtyRange(slot.byteOffset, slot.byteOffset + slot.byteLength)
      return slot
    }

    const slot: NovaGpuBufferSlot = {
      index: this._nextSlotIndex++,
      byteOffset: this._nextByteOffset,
      byteLength,
    }
    this._nextByteOffset += byteLength
    this.ensureCapacity(slot.byteOffset + slot.byteLength)
    this.markDirtyRange(slot.byteOffset, slot.byteOffset + slot.byteLength)
    return slot
  }

  /**
   * Выполняет внутреннюю операцию free slot.
   */
  freeSlot(slot: NovaGpuBufferSlot): void {
    this._freeSlots.push(slot)
    this.markDirtyRange(slot.byteOffset, slot.byteOffset + slot.byteLength)
  }

  /**
   * Помечает slot dirty.
   */
  markSlotDirty(slot: NovaGpuBufferSlot): void {
    this.markDirtyRange(slot.byteOffset, slot.byteOffset + slot.byteLength)
  }

  /**
   * Помечает dirty range.
   */
  markDirtyRange(start: number, end: number): void {
    if (end <= start) return
    this._dirtyRanges.push({ start, end })
  }

  /**
   * Выполняет внутреннюю операцию consume dirty ranges.
   */
  consumeDirtyRanges(): NovaGpuDirtyByteRange[] {
    const ranges = this.mergeDirtyRanges(this._dirtyRanges)
    this._dirtyRanges.length = 0
    return ranges
  }

  /**
   * Проверяет, нужно ли выполнить upload full.
   */
  shouldUploadFull(byteLength: number, dirtyRanges: NovaGpuDirtyByteRange[]): boolean {
    if (byteLength <= 0 || dirtyRanges.length === 0) return false
    const dirtyBytes = dirtyRanges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0)
    return dirtyBytes / byteLength >= this._fullUploadDirtyRatio
  }

  /**
   * Объединяет dirty ranges.
   */
  mergeDirtyRanges(ranges: NovaGpuDirtyByteRange[]): NovaGpuDirtyByteRange[] {
    if (ranges.length <= 1) return ranges

    const sorted = [...ranges].sort((a, b) => a.start - b.start)
    const merged: NovaGpuDirtyByteRange[] = []

    for (const range of sorted) {
      const last = merged[merged.length - 1]
      if (!last || range.start > last.end + this._mergeGapBytes) {
        merged.push({ ...range })
        continue
      }

      last.end = Math.max(last.end, range.end)
    }

    return merged
  }
}

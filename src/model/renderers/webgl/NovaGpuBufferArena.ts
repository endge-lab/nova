export interface NovaGpuDirtyByteRange {
  start: number
  end: number
}

export interface NovaGpuBufferSlot {
  index: number
  byteOffset: number
  byteLength: number
}

export class NovaGpuBufferArena {
  private _capacityBytes = 0
  private _slotByteLength = 0
  private _nextSlotIndex = 0
  private _nextByteOffset = 0
  private readonly _freeSlots: NovaGpuBufferSlot[] = []
  private readonly _dirtyRanges: NovaGpuDirtyByteRange[] = []

  constructor(
    private readonly _fullUploadDirtyRatio = 0.6,
    private readonly _mergeGapBytes = 256,
  ) {}

  get capacityBytes(): number {
    return this._capacityBytes
  }

  get allocatedSlots(): number {
    return this._nextSlotIndex - this._freeSlots.length
  }

  configureSlotByteLength(byteLength: number): void {
    if (byteLength <= 0) return
    this._slotByteLength = byteLength
  }

  ensureCapacity(byteLength: number): boolean {
    if (byteLength <= this._capacityBytes) return false

    this._capacityBytes = Math.max(byteLength, this._capacityBytes * 2)
    return true
  }

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

  freeSlot(slot: NovaGpuBufferSlot): void {
    this._freeSlots.push(slot)
    this.markDirtyRange(slot.byteOffset, slot.byteOffset + slot.byteLength)
  }

  markSlotDirty(slot: NovaGpuBufferSlot): void {
    this.markDirtyRange(slot.byteOffset, slot.byteOffset + slot.byteLength)
  }

  markDirtyRange(start: number, end: number): void {
    if (end <= start) return
    this._dirtyRanges.push({ start, end })
  }

  consumeDirtyRanges(): NovaGpuDirtyByteRange[] {
    const ranges = this.mergeDirtyRanges(this._dirtyRanges)
    this._dirtyRanges.length = 0
    return ranges
  }

  shouldUploadFull(byteLength: number, dirtyRanges: NovaGpuDirtyByteRange[]): boolean {
    if (byteLength <= 0 || dirtyRanges.length === 0) return false
    const dirtyBytes = dirtyRanges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0)
    return dirtyBytes / byteLength >= this._fullUploadDirtyRatio
  }

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

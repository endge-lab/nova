export interface NovaGpuDirtyByteRange {
  start: number
  end: number
}

export class NovaGpuBufferArena {
  private _capacityBytes = 0

  constructor(
    private readonly _fullUploadDirtyRatio = 0.6,
    private readonly _mergeGapBytes = 256,
  ) {}

  get capacityBytes(): number {
    return this._capacityBytes
  }

  ensureCapacity(byteLength: number): boolean {
    if (byteLength <= this._capacityBytes) return false

    this._capacityBytes = Math.max(byteLength, this._capacityBytes * 2)
    return true
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

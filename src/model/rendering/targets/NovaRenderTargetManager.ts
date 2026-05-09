import type { NovaRenderTarget, NovaRenderTargetKind } from '@/domain/types/rendering/index'

export interface CreateNovaRenderTargetOptions {
  id: string
  kind: NovaRenderTargetKind
  width: number
  height: number
  dpr: number
  ownerGroupId?: string
}

export class NovaRenderTargetManager {
  private readonly _targets = new Map<string, NovaRenderTarget>()
  private _memoryBytes = 0

  get targets(): NovaRenderTarget[] {
    return [...this._targets.values()]
  }

  get memoryBytes(): number {
    return this._memoryBytes
  }

  get memoryMB(): number {
    return this._memoryBytes / 1024 / 1024
  }

  get(id: string): NovaRenderTarget | undefined {
    return this._targets.get(id)
  }

  ensure(options: CreateNovaRenderTargetOptions): NovaRenderTarget {
    const current = this._targets.get(options.id)
    if (current) {
      this._memoryBytes -= this.estimateTargetBytes(current)
      current.width = options.width
      current.height = options.height
      current.dpr = options.dpr
      current.ownerGroupId = options.ownerGroupId
      this._memoryBytes += this.estimateTargetBytes(current)
      return current
    }

    const target: NovaRenderTarget = {
      id: options.id,
      kind: options.kind,
      width: options.width,
      height: options.height,
      dpr: options.dpr,
      ownerGroupId: options.ownerGroupId,
    }
    this._targets.set(target.id, target)
    this._memoryBytes += this.estimateTargetBytes(target)
    return target
  }

  delete(id: string): boolean {
    const current = this._targets.get(id)
    if (!current) return false
    this._memoryBytes -= this.estimateTargetBytes(current)
    return this._targets.delete(id)
  }

  clear(): void {
    this._targets.clear()
    this._memoryBytes = 0
  }

  protected estimateTargetBytes(target: NovaRenderTarget): number {
    return Math.max(0, Math.ceil(target.width * target.dpr))
      * Math.max(0, Math.ceil(target.height * target.dpr))
      * 4
  }
}

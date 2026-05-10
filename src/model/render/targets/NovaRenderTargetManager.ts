import type { NovaRenderTarget, NovaRenderTargetKind } from '@/domain/types/rendering/index'

/**
 * Описывает контракт CreateNovaRenderTargetOptions.
 */
export interface CreateNovaRenderTargetOptions {
  id: string
  kind: NovaRenderTargetKind
  width: number
  height: number
  dpr: number
  ownerGroupId?: string
}

/**
 * Управляет allocation и lifecycle render targets.
 */
export class NovaRenderTargetManager {
  private readonly _targets = new Map<string, NovaRenderTarget>()
  private _memoryBytes = 0

  /**
   * Возвращает targets.
   */
  get targets(): Array<NovaRenderTarget> {
    return [...this._targets.values()]
  }

  /**
   * Возвращает memory bytes.
   */
  get memoryBytes(): number {
    return this._memoryBytes
  }

  /**
   * Возвращает memory mb.
   */
  get memoryMB(): number {
    return this._memoryBytes / 1024 / 1024
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get(id: string): NovaRenderTarget | undefined {
    return this._targets.get(id)
  }

  /**
   * Выполняет внутреннюю операцию ensure.
   */
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

  /**
   * Выполняет внутреннюю операцию delete.
   */
  delete(id: string): boolean {
    const current = this._targets.get(id)
    if (!current) return false
    this._memoryBytes -= this.estimateTargetBytes(current)
    return this._targets.delete(id)
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._targets.clear()
    this._memoryBytes = 0
  }

  /**
   * Выполняет внутреннюю операцию estimate target bytes.
   */
  protected estimateTargetBytes(target: NovaRenderTarget): number {
    return Math.max(0, Math.ceil(target.width * target.dpr))
      * Math.max(0, Math.ceil(target.height * target.dpr))
      * 4
  }
}

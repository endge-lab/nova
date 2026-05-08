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

  get targets(): NovaRenderTarget[] {
    return [...this._targets.values()]
  }

  get(id: string): NovaRenderTarget | undefined {
    return this._targets.get(id)
  }

  ensure(options: CreateNovaRenderTargetOptions): NovaRenderTarget {
    const current = this._targets.get(options.id)
    if (current) {
      current.width = options.width
      current.height = options.height
      current.dpr = options.dpr
      current.ownerGroupId = options.ownerGroupId
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
    return target
  }

  delete(id: string): boolean {
    return this._targets.delete(id)
  }

  clear(): void {
    this._targets.clear()
  }
}

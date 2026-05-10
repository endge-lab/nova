import type { NovaRenderTarget } from '@/domain/types/rendering/index'
import { NovaRenderTargetManager, type CreateNovaRenderTargetOptions } from '@/model/render/targets/NovaRenderTargetManager'
import type { NovaRenderTargetResource } from '@/model/render/targets/NovaRenderTargetResource'

/**
 * Выделяет Canvas2D resources для offscreen render targets.
 */
export class NovaCanvas2DTargetManager extends NovaRenderTargetManager {
  private readonly _resources = new Map<string, NovaRenderTargetResource>()

  /**
   * Создает или обновляет logical target и соответствующий Canvas2D backing resource.
   */
  override ensure(options: CreateNovaRenderTargetOptions): NovaRenderTarget {
    const target = super.ensure(options)
    const resource = this._resources.get(target.id)
    if (resource) {
      resource.resize(target.width, target.height, target.dpr)
      return target
    }

    this._resources.set(target.id, this.createResource(target))
    return target
  }

  /**
   * Возвращает physical resource по target id.
   */
  resource(id: string): NovaRenderTargetResource | undefined {
    return this._resources.get(id)
  }

  /**
   * Удаляет logical target и его backing resource.
   */
  override delete(id: string): boolean {
    this._resources.get(id)?.destroy()
    this._resources.delete(id)
    return super.delete(id)
  }

  /**
   * Очищает все targets и resources.
   */
  override clear(): void {
    for (const resource of this._resources.values()) {
      resource.destroy()
    }
    this._resources.clear()
    super.clear()
  }

  /**
   * Создает Canvas2D resource.
   */
  private createResource(target: NovaRenderTarget): NovaRenderTargetResource {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const resize = (width: number, height: number, dpr: number): void => {
      canvas.width = Math.max(1, Math.ceil(width * dpr))
      canvas.height = Math.max(1, Math.ceil(height * dpr))
    }
    resize(target.width, target.height, target.dpr)

    return {
      target,
      canvas,
      context,
      resize,
      clear: () => {
        context?.setTransform(1, 0, 0, 1, 0, 0)
        context?.clearRect(0, 0, canvas.width, canvas.height)
      },
      destroy: () => {
        canvas.width = 1
        canvas.height = 1
      },
    }
  }
}

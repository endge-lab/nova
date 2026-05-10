import { RendererType, type NovaRenderer } from '@/domain/types/renderer.types'
import type { NovaRendererConfig } from '@/domain/types/rendering/index'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaCanvas } from '@/model/infrastructure/canvas/NovaCanvas'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'

/**
 * Выполняет публичную операцию assert nova renderer type implemented.
 */
export function assertNovaRendererTypeImplemented(type: RendererType): void {
  if (type !== RendererType.Web2D && type !== RendererType.WebGL) throw new Error(`Unsupported renderer type: ${type}`)
}

/**
 * Создает nova renderer.
 */
export function createNovaRenderer(
  type: RendererType,
  canvas: NovaCanvas,
  schema: NovaSchemaRegistry,
  rendererConfig?: NovaRendererConfig,
): NovaRenderer {
  switch (type) {
    case RendererType.Web2D:
      return new NovaRenderer2D(canvas, schema)
    case RendererType.WebGL:
      return new NovaRendererWebGL(canvas, schema, rendererConfig)
    default:
      throw new Error(`Unsupported renderer type: ${type}`)
  }
}

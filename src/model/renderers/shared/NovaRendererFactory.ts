import { RendererType, type NovaRenderer } from '@/domain/types/renderer-types'
import type { NovaRendererConfig } from '@/domain/types/rendering/index'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import { NovaRenderer2D } from '@/model/renderers/web2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/renderers/webgl/NovaRendererWebGL'

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

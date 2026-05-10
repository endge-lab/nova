import { RendererType } from '@/domain/types/renderer.types'
import type { NovaRendererConfig } from '@/domain/types/rendering/index'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaRenderBackend } from '@/model/render/backends/NovaRenderBackend'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'

/**
 * Creates the single app-level backend executor.
 */
export function createNovaRenderBackend(
  type: RendererType,
  canvas: NovaCanvas,
  schemaRegistry: NovaSchemaRegistry,
  rendererConfig: NovaRendererConfig,
): NovaRenderBackend {
  switch (type) {
    case RendererType.Web2D:
      return new NovaRenderer2D(canvas, schemaRegistry)
    case RendererType.WebGL:
      return new NovaRendererWebGL(canvas, schemaRegistry, rendererConfig)
    default:
      throw new Error(`Unsupported Nova render backend: ${String(type)}`)
  }
}

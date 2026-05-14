import { RendererType } from '@/domain/types/renderer.types'
import type { NovaRendererConfig } from '@/domain/types/rendering/index'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'
import type { NovaAssetRegistry } from '@/model/runtime/assets/NovaAssetRegistry'

/**
 * Создает единственный app-level backend executor.
 */
export function createNovaRenderBackend(
  type: RendererType,
  canvas: NovaCanvas,
  schemaRegistry: NovaSchemaRegistry,
  rendererConfig: NovaRendererConfig,
  assets: NovaAssetRegistry,
): NovaRenderBackend {
  switch (type) {
    case RendererType.Web2D:
      return new NovaRenderer2D(canvas, schemaRegistry, assets)
    case RendererType.WebGL:
      return new NovaRendererWebGL(canvas, schemaRegistry, rendererConfig, assets)
    default:
      throw new Error(`Unsupported Nova render backend: ${String(type)}`)
  }
}

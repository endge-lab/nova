import { RendererType, type NovaRenderer } from '@/domain/types/renderer-types'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import { NovaRenderer2D } from '@/model/renderers/web2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/renderers/webgl/NovaRendererWebGL'
import { NovaRendererWebGLOld } from '@/model/renderers/webgl_old/NovaRendererWebGLOld'

export function assertNovaRendererTypeImplemented(type: RendererType): void {
  if (type === RendererType.WebGL) {
    throw new Error(
      'NovaRendererWebGL is not implemented yet. Use RendererType.WebGLOld for the current legacy WebGL backend.',
    )
  }

  if (type === RendererType.WebGPU) {
    throw new Error('Nova WebGPU renderer is not implemented yet.')
  }
}

export function createNovaRenderer(type: RendererType, canvas: NovaCanvas, schema: NovaSchemaRegistry): NovaRenderer {
  switch (type) {
    case RendererType.Web2D:
      return new NovaRenderer2D(canvas, schema)
    case RendererType.WebGLOld:
      return new NovaRendererWebGLOld(canvas, schema)
    case RendererType.WebGL:
      return new NovaRendererWebGL(canvas)
    case RendererType.WebGPU:
      throw new Error('Nova WebGPU renderer is not implemented yet.')
    default:
      throw new Error(`Unsupported renderer type: ${type}`)
  }
}

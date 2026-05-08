import type { EventList } from '@endge/utils'
import type { NovaRenderFrame, NovaRendererConfig } from '@/domain/types/rendering/index'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaSurface } from '@/model/core/NovaSurface'
import { NovaRenderBuilder } from '@/model/rendering/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/rendering/compiler/NovaRenderCommandWriter'
import { NovaRenderFrameBuilder } from '@/model/rendering/compiler/NovaRenderFrameBuilder'
import { DEFAULT_NOVA_RENDERER_CONFIG } from '@/model/rendering/policy/NovaRenderPolicy'

export interface NovaRenderCompilerOptions {
  schemaRegistry: NovaSchemaRegistry
  rendererConfig?: NovaRendererConfig
}

export interface NovaRenderCompileResult {
  frame: NovaRenderFrame
}

export class NovaRenderCompiler<E extends EventList = EventList> {
  private readonly _schemaRegistry: NovaSchemaRegistry
  private readonly _rendererConfig: NovaRendererConfig

  constructor(options: NovaRenderCompilerOptions) {
    this._schemaRegistry = options.schemaRegistry
    this._rendererConfig = options.rendererConfig ?? DEFAULT_NOVA_RENDERER_CONFIG
  }

  compileSurface(surface: NovaSurface<E>): NovaRenderCompileResult {
    const startedAt = performance.now()
    const frameBuilder = new NovaRenderFrameBuilder(surface.name, {
      x: surface.x,
      y: surface.y,
      width: surface.width,
      height: surface.height,
      dpr: surface.nova.dpr,
    })
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const builder = new NovaRenderBuilder(surface.canvas, this._schemaRegistry, writer)

    surface.renderWithRenderer(builder)

    const frame = frameBuilder.build({
      compilerMs: performance.now() - startedAt,
      atlasMemoryMB: 0,
      cachedTextureMemoryMB: 0,
    })

    frame.metrics.batches = this.estimateBatches(frame.commands.map(command => command.itemId).filter(Boolean).length)

    return { frame }
  }

  private estimateBatches(drawItems: number): number {
    return Math.ceil(drawItems / this._rendererConfig.batching.maxBatchSize)
  }
}

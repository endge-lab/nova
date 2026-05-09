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
  private _lastFrame?: NovaRenderFrame

  constructor(options: NovaRenderCompilerOptions) {
    this._schemaRegistry = options.schemaRegistry
    this._rendererConfig = options.rendererConfig ?? DEFAULT_NOVA_RENDERER_CONFIG
  }

  compileSurface(surface: NovaSurface<E>): NovaRenderCompileResult {
    const startedAt = performance.now()

    if (this._lastFrame && !surface.renderSubtreeDirty) {
      this._lastFrame.metrics = {
        ...this._lastFrame.metrics,
        compilerMs: performance.now() - startedAt,
        compiledGroups: 0,
        reusedGroups: this._lastFrame.groups.length,
        nodeRenderCalls: 0,
      }
      return { frame: this._lastFrame }
    }

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
      compiledGroups: 1,
      reusedGroups: 0,
      nodeRenderCalls: surface.renderSubtreeStats.rebuiltNodes,
      atlasMemoryMB: 0,
      cachedTextureMemoryMB: 0,
    })

    frame.metrics.batches = this.estimateBatches(frame.commands.map(command => command.itemId).filter(Boolean).length)
    surface.markRenderSubtreeClean(true)
    this._lastFrame = frame

    return { frame }
  }

  private estimateBatches(drawItems: number): number {
    return Math.ceil(drawItems / this._rendererConfig.batching.maxBatchSize)
  }
}

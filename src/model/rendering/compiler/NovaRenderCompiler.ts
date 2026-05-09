import { mat3 } from 'gl-matrix'
import type { EventList } from '@endge/utils'
import type { NovaRenderFrame, NovaRendererConfig } from '@/domain/types/rendering/index'
import { NovaNode } from '@/model/core/NovaNode'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaSurface } from '@/model/core/NovaSurface'
import { NovaRenderBuilder } from '@/model/rendering/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/rendering/compiler/NovaRenderCommandWriter'
import { NovaRenderFrameBuilder } from '@/model/rendering/compiler/NovaRenderFrameBuilder'
import { DEFAULT_NOVA_RENDERER_CONFIG } from '@/model/rendering/policy/NovaRenderPolicy'
import { collectVisibleNovaRenderGroups } from '@/model/rendering/NovaRenderCulling'

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
      const culling = surface.renderGraph
        ? collectVisibleNovaRenderGroups(surface.renderGraph.groupsById.values(), this._lastFrame.viewport)
        : null
      const updatedTransforms = this.updateRetainedTransforms(surface, this._lastFrame)
      this._lastFrame.metrics = {
        ...this._lastFrame.metrics,
        compilerMs: performance.now() - startedAt,
        compiledGroups: 0,
        reusedGroups: culling?.visibleGroups.length ?? this._lastFrame.groups.length,
        nodeRenderCalls: 0,
        updatedHandles: updatedTransforms + (surface.renderGraph?.getDirtyHandleCount() ?? 0),
        dirtyStreamRanges: surface.renderGraph?.getDirtyHandleCount() ?? 0,
      }
      surface.renderGraph?.clearDirtyQueues()
      return { frame: this._lastFrame }
    }

    const frameBuilder = new NovaRenderFrameBuilder(surface.name, {
      x: surface.x,
      y: surface.y,
      width: surface.width,
      height: surface.height,
      dpr: surface.nova.dpr,
    })
    surface.renderGraph?.clearHandles()
    const writer = new NovaRenderCommandWriter(frameBuilder, frameBuilder.rootGroup, surface.renderGraph)
    const builder = new NovaRenderBuilder(surface.canvas, this._schemaRegistry, writer)

    surface.renderWithRenderer(builder)

    const frame = frameBuilder.build({
      compilerMs: performance.now() - startedAt,
      compiledGroups: 1,
      reusedGroups: 0,
      nodeRenderCalls: surface.renderSubtreeStats.rebuiltNodes,
      updatedHandles: surface.renderGraph?.handlesByItemId.size ?? 0,
      atlasMemoryMB: 0,
      cachedTextureMemoryMB: 0,
    })

    for (const command of frame.commands) {
      if (command.type === 'drawSchemaBatch') {
        surface.renderGraph?.rebuildBatchPlan(frameBuilder.rootGroup.id, command.schemaSemanticScope)
      }
    }
    if (surface.renderGraph) {
      const culling = collectVisibleNovaRenderGroups(surface.renderGraph.groupsById.values(), frame.viewport)
      frame.metrics.reusedGroups = culling.visibleGroups.length
    }
    frame.metrics.batches = this.estimateBatches(frame.commands.map(command => command.itemId).filter(Boolean).length)
    surface.markRenderSubtreeClean(true)
    surface.renderGraph?.clearDirtyQueues()
    this._lastFrame = frame

    return { frame }
  }

  private estimateBatches(drawItems: number): number {
    return Math.ceil(drawItems / this._rendererConfig.batching.maxBatchSize)
  }

  private updateRetainedTransforms(surface: NovaSurface<E>, frame: NovaRenderFrame): number {
    const graph = surface.renderGraph
    if (!graph || graph.transformDirtyNodeIds.size === 0) return 0

    const matrices = new Map<string, mat3>()
    this.collectDirtyNodeMatrices(surface, graph.transformDirtyNodeIds, matrices)

    let updated = 0
    for (const command of frame.commands) {
      if (command.type !== 'setTransform' || !command.nodeId) continue

      const matrix = matrices.get(command.nodeId)
      if (!matrix) continue

      command.transform = matrix
      updated += 1
    }

    graph.clearDirtyQueues()
    return updated
  }

  private collectDirtyNodeMatrices(node: NovaNode<any>, dirtyNodeIds: Set<string>, matrices: Map<string, mat3>): void {
    if (dirtyNodeIds.has(node.renderNodeId)) {
      matrices.set(node.renderNodeId, mat3.clone(node.matrix))
    }

    for (const child of node.children) {
      if (child instanceof NovaNode) {
        this.collectDirtyNodeMatrices(child, dirtyNodeIds, matrices)
      }
    }
  }
}

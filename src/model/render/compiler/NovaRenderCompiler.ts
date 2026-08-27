import type { EventList } from '@endge/utils'
import type { NovaRendererConfig, NovaRenderFrame } from '@/domain/types/rendering/index'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import { mat3 } from 'gl-matrix'
import { RendererType } from '@/domain/types/renderer.types'
import { NovaRenderBuilder } from '@/model/render/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import { NovaRenderFrameBuilder } from '@/model/render/compiler/NovaRenderFrameBuilder'
import { collectVisibleNovaRenderGroups } from '@/model/render/graph/nova-render-culling'
import { DEFAULT_NOVA_RENDERER_CONFIG } from '@/model/render/policy/nova-render-policy'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает контракт NovaRenderCompilerOptions.
 */
export interface NovaRenderCompilerOptions {
  schemaRegistry: NovaSchemaRegistry
  rendererConfig?: NovaRendererConfig
  rendererType?: RendererType
}

/**
 * Описывает контракт NovaRenderCompileResult.
 */
export interface NovaRenderCompileResult {
  frame: NovaRenderFrame
}

/**
 * Компилирует Nova surfaces в retained render frame и обновляет render graph.
 */
export class NovaRenderCompiler<E extends EventList = EventList> {
  private readonly _schemaRegistry: NovaSchemaRegistry
  private readonly _rendererConfig: NovaRendererConfig
  private readonly _rendererType: RendererType
  private _lastFrame?: NovaRenderFrame

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(options: NovaRenderCompilerOptions) {
    this._schemaRegistry = options.schemaRegistry
    this._rendererConfig = options.rendererConfig ?? DEFAULT_NOVA_RENDERER_CONFIG
    this._rendererType = options.rendererType ?? RendererType.WebGL
  }

  /**
   * Компилирует surface.
   */
  compileSurface(surface: NovaSurface<E>): NovaRenderCompileResult {
    const startedAt = performance.now()

    if (this._lastFrame && !surface.renderFrameDirty) {
      const culling = surface.renderGraph
        ? collectVisibleNovaRenderGroups(surface.renderGraph.groupsById.values(), this._lastFrame.viewport)
        : null
      const updatedTransforms = this._updateRetainedTransforms(surface, this._lastFrame)
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
    }, this._rendererType)
    surface.renderGraph?.clearHandles()
    const writer = new NovaRenderCommandWriter(frameBuilder, frameBuilder.rootGroup, surface.renderGraph)
    const builder = new NovaRenderBuilder(surface.canvas, this._schemaRegistry, writer)

    surface.renderWithContext(builder)

    const frame = frameBuilder.build({
      compilerMs: performance.now() - startedAt,
      compiledGroups: 1,
      reusedGroups: 0,
      nodeRenderCalls: surface.renderCompileStats.rebuiltNodes,
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
    frame.metrics.batches = this._estimateBatches(frame.commands.map(command => command.itemId).filter(Boolean).length)
    surface.markRenderFrameClean(true)
    surface.renderGraph?.clearDirtyQueues()
    this._lastFrame = frame

    return { frame }
  }

  /**
   * Выполняет внутреннюю операцию estimate batches.
   */
  private _estimateBatches(drawItems: number): number {
    return Math.ceil(drawItems / this._rendererConfig.batching.maxBatchSize)
  }

  /**
   * Обновляет retained transforms.
   */
  private _updateRetainedTransforms(surface: NovaSurface<E>, frame: NovaRenderFrame): number {
    const graph = surface.renderGraph
    if (!graph || graph.transformDirtyNodeIds.size === 0) {
      return 0
    }

    const matrices = new Map<string, mat3>()
    this._collectDirtyNodeMatrices(surface, graph.transformDirtyNodeIds, matrices)

    let updated = 0
    for (const command of frame.commands) {
      if (command.type !== 'setTransform' || !command.nodeId) {
        continue
      }

      const matrix = matrices.get(command.nodeId)
      if (!matrix) {
        continue
      }

      command.transform = matrix
      updated += 1
    }

    for (const item of frame.items) {
      if (!item.nodeId) {
        continue
      }

      const matrix = matrices.get(item.nodeId)
      if (!matrix) {
        continue
      }

      item.transform = matrix
      updated += 1
    }

    graph.clearDirtyQueues()
    return updated
  }

  /**
   * Выполняет внутреннюю операцию collect dirty node matrices.
   */
  private _collectDirtyNodeMatrices(
    node: NovaNode<any>,
    dirtyNodeIds: Set<string>,
    matrices: Map<string, mat3>,
    ancestorDirty = false,
  ): void {
    const transformDirty = ancestorDirty || dirtyNodeIds.has(node.renderNodeId)

    if (transformDirty) {
      matrices.set(node.renderNodeId, mat3.clone(node.matrix))
    }

    for (const child of node.children) {
      if (child instanceof NovaNode) {
        this._collectDirtyNodeMatrices(child, dirtyNodeIds, matrices, transformDirty)
      }
    }
  }
}

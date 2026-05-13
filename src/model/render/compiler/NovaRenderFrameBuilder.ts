import { RendererType } from '@/domain/types/renderer.types'
import type {
  NovaRenderCommand,
  NovaRenderFrame,
  NovaRenderGroup,
  NovaRenderItem,
  NovaRenderLayer,
  NovaRenderMetrics,
  NovaRenderTarget,
  NovaRenderViewport,
} from '@/domain/types/rendering/index'
import { createNovaRenderLayer } from '@/model/render/graph/nova-render-layer'

let frameId = 0

/**
 * Создает empty metrics.
 */
function createEmptyMetrics(): NovaRenderMetrics {
  return {
    compilerMs: 0,
    backendMs: 0,
    uploadMs: 0,
    drawMs: 0,
    drawCalls: 0,
    batches: 0,
    bufferDataCalls: 0,
    bufferSubDataCalls: 0,
    compiledGroups: 0,
    commands: 0,
    dirtyRangeCount: 0,
    dirtyStreamRanges: 0,
    fullUploads: 0,
    gpuBufferCapacityBytes: 0,
    items: 0,
    groups: 0,
    nodeRenderCalls: 0,
    textRasterMs: 0,
    textRasterCount: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
    textRasterDeferred: 0,
    textAtlasPages: 0,
    effectiveTextRasterScale: 0,
    atlasUploads: 0,
    uniformOnlyFrames: 0,
    updatedHandles: 0,
    atlasMemoryMB: 0,
    cachedTextureMemoryMB: 0,
    reusedGroups: 0,
  }
}

/**
 * Собирает итоговый NovaRenderFrame из layers, groups, commands и metrics.
 */
export class NovaRenderFrameBuilder {
  private readonly _groups: Array<NovaRenderGroup> = []
  private readonly _items: Array<NovaRenderItem> = []
  private readonly _commands: Array<NovaRenderCommand> = []
  private readonly _targets: Array<NovaRenderTarget> = []
  private readonly _layers: Array<NovaRenderLayer> = []
  private readonly _mainLayer: NovaRenderLayer
  private _order = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _surfaceId: string,
    private readonly _viewport: NovaRenderViewport,
    private readonly _rendererType: RendererType = RendererType.WebGL,
  ) {
    this._mainLayer = createNovaRenderLayer('main')
    this._layers.push(this._mainLayer)
    this._groups.push(this._mainLayer.rootGroup)
  }

  /**
   * Возвращает main layer.
   */
  get mainLayer(): NovaRenderLayer {
    return this._mainLayer
  }

  /**
   * Возвращает root group.
   */
  get rootGroup(): NovaRenderGroup {
    return this._mainLayer.rootGroup
  }

  /**
   * Выполняет внутреннюю операцию next order.
   */
  nextOrder(): number {
    this._order += 1
    return this._order
  }

  /**
   * Выполняет внутреннюю операцию peek order.
   */
  peekOrder(): number {
    return this._order
  }

  /**
   * Добавляет command.
   */
  addCommand(command: Omit<NovaRenderCommand, 'order'> & { order?: number }): NovaRenderCommand {
    const next: NovaRenderCommand = {
      ...command,
      order: command.order ?? this.nextOrder(),
    }
    this._commands.push(next)
    this.rootGroup.instructionBuffer.commands.push(next)
    return next
  }

  /**
   * Добавляет item.
   */
  addItem(item: NovaRenderItem): NovaRenderItem {
    this._items.push(item)
    this.rootGroup.instructionBuffer.items.push(item)
    return item
  }

  /**
   * Добавляет group.
   */
  addGroup(group: NovaRenderGroup): NovaRenderGroup {
    this._groups.push(group)
    return group
  }

  /**
   * Добавляет target.
   */
  addTarget(target: NovaRenderTarget): NovaRenderTarget {
    this._targets.push(target)
    return target
  }

  /**
   * Выполняет внутреннюю операцию build.
   */
  build(metrics: Partial<NovaRenderMetrics> = {}): NovaRenderFrame {
    const resolvedMetrics = {
      ...createEmptyMetrics(),
      ...metrics,
      commands: this._commands.length,
      items: this._items.length,
      groups: this._groups.length,
    }

    return {
      id: ++frameId,
      surfaceId: this._surfaceId,
      rendererType: this._rendererType,
      viewport: this._viewport,
      layers: this._layers,
      targets: this._targets,
      groups: this._groups,
      items: this._items,
      commands: this._commands,
      resourceDelta: {
        texturesCreated: 0,
        texturesUpdated: 0,
        texturesEvicted: 0,
        textRunsRasterized: 0,
        bytesUploaded: 0,
      },
      metrics: resolvedMetrics,
    }
  }
}

import { RendererType } from '@/domain/types/renderer-types'
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
import { createNovaRenderLayer } from '@/model/rendering/NovaRenderLayer'

let frameId = 0

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
    updatedHandles: 0,
    atlasMemoryMB: 0,
    cachedTextureMemoryMB: 0,
    reusedGroups: 0,
  }
}

export class NovaRenderFrameBuilder {
  private readonly _groups: NovaRenderGroup[] = []
  private readonly _items: NovaRenderItem[] = []
  private readonly _commands: NovaRenderCommand[] = []
  private readonly _targets: NovaRenderTarget[] = []
  private readonly _layers: NovaRenderLayer[] = []
  private readonly _mainLayer: NovaRenderLayer
  private _order = 0

  constructor(
    private readonly _surfaceId: string,
    private readonly _viewport: NovaRenderViewport,
  ) {
    this._mainLayer = createNovaRenderLayer('main')
    this._layers.push(this._mainLayer)
    this._groups.push(this._mainLayer.rootGroup)
  }

  get mainLayer(): NovaRenderLayer {
    return this._mainLayer
  }

  get rootGroup(): NovaRenderGroup {
    return this._mainLayer.rootGroup
  }

  nextOrder(): number {
    this._order += 1
    return this._order
  }

  addCommand(command: Omit<NovaRenderCommand, 'order'> & { order?: number }): NovaRenderCommand {
    const next: NovaRenderCommand = {
      ...command,
      order: command.order ?? this.nextOrder(),
    }
    this._commands.push(next)
    this.rootGroup.instructionBuffer.commands.push(next)
    return next
  }

  addItem(item: NovaRenderItem): NovaRenderItem {
    this._items.push(item)
    this.rootGroup.instructionBuffer.items.push(item)
    return item
  }

  addGroup(group: NovaRenderGroup): NovaRenderGroup {
    this._groups.push(group)
    return group
  }

  addTarget(target: NovaRenderTarget): NovaRenderTarget {
    this._targets.push(target)
    return target
  }

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
      rendererType: RendererType.WebGL,
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

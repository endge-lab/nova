import { mat3 } from 'gl-matrix'
import type {
  NovaRenderClip,
  NovaRenderCommand,
  NovaRenderHandle,
  NovaRenderGroup,
  NovaRenderItem,
} from '@/domain/types/rendering/index'
import type { NovaSchemaItem, NovaSemanticScopeKind } from '@/domain/types/renderer-types'
import { createNovaRenderItem, createNovaRenderItemBatchKey, resolveNovaRenderItemKind, resolveNovaRenderStreamKind } from '@/model/rendering/NovaRenderItem'
import type { NovaRenderGraph } from '@/model/rendering/NovaRenderGraph'
import type { NovaRenderFrameBuilder } from '@/model/rendering/compiler/NovaRenderFrameBuilder'

export class NovaRenderCommandWriter {
  private readonly _transformStack: mat3[] = []
  private readonly _clipStack: NovaRenderClip[] = []
  private _currentTransform = mat3.create()
  private _itemId = 0
  private _commandId = 0
  private _handleId = 0
  private _currentNodeId = 'surface'

  constructor(
    private readonly _frameBuilder: NovaRenderFrameBuilder,
    private readonly _group: NovaRenderGroup = _frameBuilder.rootGroup,
    private readonly _graph?: NovaRenderGraph,
  ) {}

  get currentTransform(): mat3 {
    return this._currentTransform
  }

  get currentClip(): NovaRenderClip | null {
    return this._clipStack.length > 0 ? this._clipStack[this._clipStack.length - 1] : null
  }

  get currentNodeId(): string {
    return this._currentNodeId
  }

  setCurrentNode(nodeId: string): void {
    this._currentNodeId = nodeId
  }

  clear(): NovaRenderCommand {
    return this.command({ type: 'clear' })
  }

  save(): NovaRenderCommand {
    this._transformStack.push(mat3.clone(this._currentTransform))
    return this.command({ type: 'save' })
  }

  restore(): NovaRenderCommand {
    this._currentTransform = this._transformStack.pop() ?? mat3.create()
    return this.command({ type: 'restore' })
  }

  setTransform(matrix: mat3): NovaRenderCommand {
    this._currentTransform = mat3.clone(matrix)
    return this.command({
      type: 'setTransform',
      transform: mat3.clone(matrix),
    })
  }

  clip(x: number, y: number, width: number, height: number): NovaRenderCommand {
    const clip = { x, y, width, height }
    this._clipStack.push(clip)
    return this.command({
      type: 'clip',
      clip,
    })
  }

  clearClip(): NovaRenderCommand {
    this._clipStack.pop()
    return this.command({ type: 'clearClip' })
  }

  drawSchemaItem(item: NovaSchemaItem<any>, nodeId = this._currentNodeId): NovaRenderItem {
    const order = this._frameBuilder.nextOrder()
    const renderItem = createNovaRenderItem({
      id: `item:${++this._itemId}`,
      nodeId,
      groupId: this._group.id,
      layerId: this._group.layerId,
      kind: resolveNovaRenderItemKind(item),
      order,
      batchKey: createNovaRenderItemBatchKey(item),
      schemaItem: item,
      transform: mat3.clone(this._currentTransform),
      clip: this.currentClip,
    })

    this._frameBuilder.addItem(renderItem)
    this.addHandle(renderItem, item, 0, 1, nodeId)
    this.command({
      type: 'drawItem',
      itemId: renderItem.id,
      order,
    })

    return renderItem
  }

  drawSchemaBatch(
    items: NovaSchemaItem<any>[],
    mode: 'batched' | 'ordered' = 'batched',
    semanticScope?: NovaSemanticScopeKind,
    contentVersion?: number,
  ): NovaRenderCommand {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const renderItem = createNovaRenderItem({
        id: `item:${++this._itemId}`,
        nodeId: this._currentNodeId,
        groupId: this._group.id,
        layerId: this._group.layerId,
        kind: resolveNovaRenderItemKind(item),
        order: this._frameBuilder.peekOrder() + index + 1,
        batchKey: createNovaRenderItemBatchKey(item),
        schemaItem: item,
        transform: mat3.clone(this._currentTransform),
        clip: this.currentClip,
      })

      this.addHandle(renderItem, item, index, 1, this._currentNodeId)
    }

    return this.command({
      type: 'drawSchemaBatch',
      schemaItems: items,
      schemaMode: mode,
      schemaSemanticScope: semanticScope,
      schemaContentVersion: contentVersion,
    })
  }

  cursor(type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): NovaRenderCommand {
    return this.command({
      type: 'cursor',
      cursor: type,
    })
  }

  command(command: Omit<NovaRenderCommand, 'id' | 'order'> & { order?: number }): NovaRenderCommand {
    return this._frameBuilder.addCommand({
      ...command,
      id: `cmd:${++this._commandId}`,
      nodeId: command.nodeId ?? this._currentNodeId,
      groupId: this._group.id,
      layerId: this._group.layerId,
    })
  }

  private addHandle(renderItem: NovaRenderItem, item: NovaSchemaItem<any>, offset: number, count: number, nodeId: string): void {
    if (!this._graph) return

    const handle: NovaRenderHandle = {
      id: `handle:${++this._handleId}`,
      nodeId,
      itemId: renderItem.id,
      groupId: renderItem.groupId,
      layerId: renderItem.layerId,
      streamId: `${renderItem.groupId}:${resolveNovaRenderStreamKind(item)}`,
      streamKind: resolveNovaRenderStreamKind(item),
      offset,
      count,
      batchKey: renderItem.batchKey,
      versions: {
        transform: 0,
        layout: 0,
        paint: 0,
        children: 0,
        resource: 0,
        cache: 0,
        visibility: 0,
      },
      localBounds: 'x' in item && 'y' in item && 'width' in item && 'height' in item
        ? { x: item.x, y: item.y, width: item.width, height: item.height }
        : undefined,
    }

    this._graph.addHandle(handle)
  }
}

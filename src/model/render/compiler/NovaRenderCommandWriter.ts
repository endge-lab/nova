import { mat3 } from 'gl-matrix'
import type {
  NovaRenderClip,
  NovaRenderCommand,
  NovaRenderHandle,
  NovaRenderGroup,
  NovaRenderItem,
  NovaRenderTargetKind,
} from '@/domain/types/rendering/index'
import type {
  NovaIconBatch,
  NovaParticleBatch,
  NovaRectBatch,
  NovaSchemaItem,
  NovaSemanticScopeKind,
  NovaStripeRectBatch,
  NovaTextBatch,
} from '@/domain/types/renderer.types'
import { createNovaRenderItem, createNovaRenderItemBatchKey, resolveNovaRenderItemKind, resolveNovaRenderStreamKind } from '@/model/render/graph/nova-render-item'
import type { NovaRenderGraph } from '@/model/render/graph/NovaRenderGraph'
import type { NovaRenderFrameBuilder } from '@/model/render/compiler/NovaRenderFrameBuilder'

/**
 * Записывает render commands в instruction buffer и поддерживает clip stack.
 */
export class NovaRenderCommandWriter {
  private readonly _transformStack: Array<mat3> = []
  private readonly _clipStack: Array<NovaRenderClip> = []
  private _currentTransform = mat3.create()
  private _itemId = 0
  private _commandId = 0
  private _handleId = 0
  private _currentNodeId = 'surface'

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _frameBuilder: NovaRenderFrameBuilder,
    private readonly _group: NovaRenderGroup = _frameBuilder.rootGroup,
    private readonly _graph?: NovaRenderGraph,
  ) {}

  /**
   * Возвращает current transform.
   */
  get currentTransform(): mat3 {
    return this._currentTransform
  }

  /**
   * Возвращает current clip.
   */
  get currentClip(): NovaRenderClip | null {
    return this._clipStack.length > 0 ? this._clipStack[this._clipStack.length - 1] : null
  }

  /**
   * Возвращает current node id.
   */
  get currentNodeId(): string {
    return this._currentNodeId
  }

  /**
   * Обновляет current node.
   */
  setCurrentNode(nodeId: string): void {
    this._currentNodeId = nodeId
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): NovaRenderCommand {
    return this.command({ type: 'clear' })
  }

  /**
   * Выполняет внутреннюю операцию save.
   */
  save(): NovaRenderCommand {
    this._transformStack.push(mat3.clone(this._currentTransform))
    return this.command({ type: 'save' })
  }

  /**
   * Выполняет внутреннюю операцию restore.
   */
  restore(): NovaRenderCommand {
    this._currentTransform = this._transformStack.pop() ?? mat3.create()
    return this.command({ type: 'restore' })
  }

  /**
   * Обновляет transform.
   */
  setTransform(matrix: mat3): NovaRenderCommand {
    this._currentTransform = mat3.clone(matrix)
    return this.command({
      type: 'setTransform',
      transform: mat3.clone(matrix),
    })
  }

  /**
   * Выполняет внутреннюю операцию clip.
   */
  clip(x: number, y: number, width: number, height: number): NovaRenderCommand {
    const clip = { x, y, width, height }
    this._clipStack.push(clip)
    return this.command({
      type: 'clip',
      clip,
    })
  }

  /**
   * Очищает clip.
   */
  clearClip(): NovaRenderCommand {
    this._clipStack.pop()
    return this.command({ type: 'clearClip' })
  }

  /**
   * Начинает запись команд в texture/cache render target.
   */
  beginRenderTarget(
    id: string,
    width: number,
    height: number,
    options: { dpr?: number; kind?: Extract<NovaRenderTargetKind, 'texture' | 'cache' | 'effect'> } = {},
  ): NovaRenderCommand {
    const target = this._frameBuilder.addTarget({
      id,
      kind: options.kind ?? 'cache',
      width,
      height,
      dpr: options.dpr ?? 1,
      ownerGroupId: this._group.id,
    })
    return this.command({
      type: 'beginRenderTarget',
      target,
      targetId: id,
    })
  }

  /**
   * Завершает запись в render target и возвращает backend на screen.
   */
  endRenderTarget(): NovaRenderCommand {
    return this.command({ type: 'endRenderTarget' })
  }

  /**
   * Рисует ранее записанный render target как texture quad.
   */
  drawRenderTarget(id: string, x: number, y: number, width: number, height: number): NovaRenderCommand {
    return this.command({
      type: 'drawRenderTarget',
      targetId: id,
      x,
      y,
      width,
      height,
    })
  }

  /**
   * Выполняет внутреннюю операцию draw schema item.
   */
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

  /**
   * Выполняет внутреннюю операцию draw schema batch.
   */
  drawSchemaBatch(
    items: Array<NovaSchemaItem<any>>,
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

  /**
   * Записывает retained particle batch как отдельный stream command.
   */
  drawParticles(batch: NovaParticleBatch, nodeId = this._currentNodeId): NovaRenderCommand {
    const order = this._frameBuilder.nextOrder()
    const streamKind = batch.kind === 'sprite' ? 'particle-sprite' : 'particle-circle'
    const item = createNovaRenderItem({
      id: `item:${++this._itemId}`,
      nodeId,
      groupId: this._group.id,
      layerId: this._group.layerId,
      kind: streamKind,
      order,
      batchKey: `particles:${batch.kind}:${batch.texture ? 'texture' : 'solid'}`,
      bounds: 'x' in batch && 'y' in batch && 'width' in batch && 'height' in batch
        ? { x: batch.x as number, y: batch.y as number, width: batch.width as number, height: batch.height as number }
        : undefined,
      clip: this.currentClip,
    })

    this._frameBuilder.addItem(item)
    this.addParticleHandle(item, batch, nodeId, streamKind)

    return this.command({
      type: 'drawParticles',
      itemId: item.id,
      particleBatch: batch,
      order,
    })
  }

  /**
   * Записывает retained rect batch как отдельный stream command.
   */
  drawRectBatch(batch: NovaRectBatch, nodeId = this._currentNodeId): NovaRenderCommand {
    const order = this._frameBuilder.nextOrder()
    const item = createNovaRenderItem({
      id: `item:${++this._itemId}`,
      nodeId,
      groupId: this._group.id,
      layerId: this._group.layerId,
      kind: 'rect-batch',
      order,
      batchKey: 'rect-batch:plain',
      bounds: 'x' in batch && 'y' in batch && 'width' in batch && 'height' in batch
        ? { x: batch.x[0] ?? 0, y: batch.y[0] ?? 0, width: batch.width[0] ?? 0, height: batch.height[0] ?? 0 }
        : undefined,
      clip: this.currentClip,
    })

    this._frameBuilder.addItem(item)
    this.addRectBatchHandle(item, batch, nodeId)

    return this.command({
      type: 'drawRectBatch',
      itemId: item.id,
      rectBatch: batch,
      order,
    })
  }

  /**
   * Записывает retained stripe batch как отдельный stream command.
   */
  drawStripeBatch(batch: NovaStripeRectBatch, nodeId = this._currentNodeId): NovaRenderCommand {
    return this.drawGenericBatch('drawStripeBatch', 'stripe-batch', 'stripe-batch:fill', batch, nodeId)
  }

  /**
   * Записывает retained icon batch как отдельный stream command.
   */
  drawIconBatch(batch: NovaIconBatch, nodeId = this._currentNodeId): NovaRenderCommand {
    return this.drawGenericBatch('drawIconBatch', 'icon-batch', 'icon-batch:texture', batch, nodeId)
  }

  /**
   * Записывает retained text batch как отдельный stream command.
   */
  drawTextBatch(batch: NovaTextBatch, nodeId = this._currentNodeId): NovaRenderCommand {
    return this.drawGenericBatch('drawTextBatch', 'text-batch', 'text-batch:atlas', batch, nodeId)
  }

  /**
   * Выполняет внутреннюю операцию cursor.
   */
  cursor(type: string): NovaRenderCommand {
    return this.command({
      type: 'cursor',
      cursor: type,
    })
  }

  /**
   * Выполняет внутреннюю операцию command.
   */
  command(command: Omit<NovaRenderCommand, 'id' | 'order'> & { order?: number }): NovaRenderCommand {
    return this._frameBuilder.addCommand({
      ...command,
      id: `cmd:${++this._commandId}`,
      nodeId: command.nodeId ?? this._currentNodeId,
      groupId: this._group.id,
      layerId: this._group.layerId,
    })
  }

  /**
   * Добавляет handle.
   */
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

  /**
   * Добавляет handle для retained particle stream.
   */
  private addParticleHandle(renderItem: NovaRenderItem, batch: NovaParticleBatch, nodeId: string, streamKind: NovaRenderHandle['streamKind']): void {
    if (!this._graph) return

    const handle: NovaRenderHandle = {
      id: `handle:${++this._handleId}`,
      nodeId,
      itemId: renderItem.id,
      groupId: renderItem.groupId,
      layerId: renderItem.layerId,
      streamId: `${renderItem.groupId}:${streamKind}`,
      streamKind,
      offset: 0,
      count: batch.count,
      batchKey: renderItem.batchKey,
      versions: {
        transform: 0,
        layout: 0,
        paint: batch.staticRevision ?? 0,
        children: 0,
        resource: 0,
        cache: 0,
        visibility: 0,
      },
      localBounds: renderItem.bounds,
    }

    this._graph.addHandle(handle)
  }

  /**
   * Добавляет handle для retained rect stream.
   */
  private addRectBatchHandle(renderItem: NovaRenderItem, batch: NovaRectBatch, nodeId: string): void {
    if (!this._graph) return

    const handle: NovaRenderHandle = {
      id: `handle:${++this._handleId}`,
      nodeId,
      itemId: renderItem.id,
      groupId: renderItem.groupId,
      layerId: renderItem.layerId,
      streamId: `${renderItem.groupId}:rect-batch`,
      streamKind: 'rect-batch',
      offset: 0,
      count: batch.count,
      batchKey: renderItem.batchKey,
      versions: {
        transform: 0,
        layout: batch.revision ?? 0,
        paint: batch.staticRevision ?? 0,
        children: 0,
        resource: 0,
        cache: 0,
        visibility: 0,
      },
      localBounds: renderItem.bounds,
    }

    this._graph.addHandle(handle)
  }

  /**
   * Записывает retained generic batch command.
   */
  private drawGenericBatch(
    type: 'drawStripeBatch' | 'drawIconBatch' | 'drawTextBatch',
    streamKind: 'stripe-batch' | 'icon-batch' | 'text-batch',
    batchKey: string,
    batch: NovaStripeRectBatch | NovaIconBatch | NovaTextBatch,
    nodeId: string,
  ): NovaRenderCommand {
    const order = this._frameBuilder.nextOrder()
    const item = createNovaRenderItem({
      id: `item:${++this._itemId}`,
      nodeId,
      groupId: this._group.id,
      layerId: this._group.layerId,
      kind: streamKind,
      order,
      batchKey,
      bounds: 'x' in batch && 'y' in batch && 'width' in batch && 'height' in batch
        ? { x: batch.x[0] ?? 0, y: batch.y[0] ?? 0, width: batch.width[0] ?? 0, height: batch.height[0] ?? 0 }
        : undefined,
      clip: this.currentClip,
    })

    this._frameBuilder.addItem(item)
    this.addGenericBatchHandle(item, batch, nodeId, streamKind)

    return this.command({
      type,
      itemId: item.id,
      stripeBatch: type === 'drawStripeBatch' ? batch as NovaStripeRectBatch : undefined,
      iconBatch: type === 'drawIconBatch' ? batch as NovaIconBatch : undefined,
      textBatch: type === 'drawTextBatch' ? batch as NovaTextBatch : undefined,
      order,
    })
  }

  /**
   * Добавляет handle для retained generic stream.
   */
  private addGenericBatchHandle(
    renderItem: NovaRenderItem,
    batch: NovaStripeRectBatch | NovaIconBatch | NovaTextBatch,
    nodeId: string,
    streamKind: 'stripe-batch' | 'icon-batch' | 'text-batch',
  ): void {
    if (!this._graph) return

    const handle: NovaRenderHandle = {
      id: `handle:${++this._handleId}`,
      nodeId,
      itemId: renderItem.id,
      groupId: renderItem.groupId,
      layerId: renderItem.layerId,
      streamId: `${renderItem.groupId}:${streamKind}`,
      streamKind,
      offset: 0,
      count: batch.count,
      batchKey: renderItem.batchKey,
      versions: {
        transform: 0,
        layout: batch.revision ?? 0,
        paint: batch.staticRevision ?? 0,
        children: 0,
        resource: 0,
        cache: 0,
        visibility: 0,
      },
      localBounds: renderItem.bounds,
    }

    this._graph.addHandle(handle)
  }
}

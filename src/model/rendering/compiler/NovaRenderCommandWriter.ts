import { mat3 } from 'gl-matrix'
import type {
  NovaRenderClip,
  NovaRenderCommand,
  NovaRenderGroup,
  NovaRenderItem,
} from '@/domain/types/rendering/index'
import type { NovaSchemaItem } from '@/domain/types/renderer-types'
import { createNovaRenderItem, createNovaRenderItemBatchKey, resolveNovaRenderItemKind } from '@/model/rendering/NovaRenderItem'
import type { NovaRenderFrameBuilder } from '@/model/rendering/compiler/NovaRenderFrameBuilder'

export class NovaRenderCommandWriter {
  private readonly _transformStack: mat3[] = []
  private readonly _clipStack: NovaRenderClip[] = []
  private _currentTransform = mat3.create()
  private _itemId = 0
  private _commandId = 0

  constructor(
    private readonly _frameBuilder: NovaRenderFrameBuilder,
    private readonly _group: NovaRenderGroup = _frameBuilder.rootGroup,
  ) {}

  get currentTransform(): mat3 {
    return this._currentTransform
  }

  get currentClip(): NovaRenderClip | null {
    return this._clipStack.length > 0 ? this._clipStack[this._clipStack.length - 1] : null
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

  drawSchemaItem(item: NovaSchemaItem<any>, nodeId?: string): NovaRenderItem {
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
    this.command({
      type: 'drawItem',
      itemId: renderItem.id,
      order,
    })

    return renderItem
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
      groupId: this._group.id,
      layerId: this._group.layerId,
    })
  }
}

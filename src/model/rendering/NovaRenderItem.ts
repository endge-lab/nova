import type {
  NovaRenderClip,
  NovaRenderGroupId,
  NovaRenderItem,
  NovaRenderItemKind,
  NovaRenderLayerId,
} from '@/domain/types/rendering/index'
import type { NovaBounds, NovaSchemaItem } from '@/domain/types/renderer-types'
import type { mat3 } from 'gl-matrix'

export interface CreateNovaRenderItemOptions {
  id: string
  groupId: NovaRenderGroupId
  layerId: NovaRenderLayerId
  kind: NovaRenderItemKind
  order: number
  batchKey: string
  nodeId?: string
  schemaItem?: NovaSchemaItem<any>
  transform?: mat3
  clip?: NovaRenderClip | null
  bounds?: NovaBounds
}

export function createNovaRenderItem(options: CreateNovaRenderItemOptions): NovaRenderItem {
  return {
    id: options.id,
    nodeId: options.nodeId,
    groupId: options.groupId,
    layerId: options.layerId,
    kind: options.kind,
    order: options.order,
    batchKey: options.batchKey,
    schemaItem: options.schemaItem,
    transform: options.transform,
    clip: options.clip,
    bounds: options.bounds,
  }
}

export function resolveNovaRenderItemKind(item: NovaSchemaItem<any>): NovaRenderItemKind {
  switch (item.type) {
    case 'rect':
    case 'border':
    case 'line':
    case 'circle':
    case 'polygon':
    case 'text':
    case 'icon':
      return item.type
    default:
      return 'custom'
  }
}

export function createNovaRenderItemBatchKey(item: NovaSchemaItem<any>): string {
  if (item.type === 'rect') {
    const background = typeof item.styles?.background === 'string' ? item.styles.background : 'texture'
    const border = item.styles?.border ? 'border' : 'none'
    return `rect:${background}:${border}:${item.styles?.opacity ?? 1}`
  }

  if (item.type === 'border') return `border:${item.styles?.color ?? 'none'}:${item.styles?.width ?? 0}`
  if (item.type === 'text') return `text:${item.styles?.font?.family ?? 'sans'}:${item.styles?.font?.size ?? 12}:${item.styles?.font?.weight ?? 'normal'}`
  if (item.type === 'icon') return `icon:${typeof item.icon === 'string' ? item.icon : 'source'}`

  return item.type
}

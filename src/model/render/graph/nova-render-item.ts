import type { mat3 } from 'gl-matrix'
import type {
  NovaRenderClip,
  NovaRenderGroupId,
  NovaRenderItem,
  NovaRenderItemKind,
  NovaRenderLayerId,
  NovaRenderStreamKind,
} from '@/domain/types/rendering/index'
import type { NovaBounds, NovaSchemaItem } from '@/domain/types/renderer.types'

/**
 * Описывает контракт CreateNovaRenderItemOptions.
 */
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

/**
 * Создает nova render item.
 */
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

/**
 * Вычисляет nova render item kind.
 */
export function resolveNovaRenderItemKind(item: NovaSchemaItem<any>): NovaRenderItemKind {
  switch (item.type) {
    case 'rect':
    case 'border':
    case 'line':
    case 'circle':
    case 'arc':
    case 'polygon':
    case 'text':
    case 'icon':
    case 'nine-slice-image':
    case 'pattern-rect':
      return item.type
    default:
      return 'custom'
  }
}

/**
 * Создает nova render item batch key.
 */
export function createNovaRenderItemBatchKey(item: NovaSchemaItem<any>): string {
  if (item.type === 'rect') {
    const background = typeof item.styles?.background === 'string' ? item.styles.background : 'texture'
    const border = item.styles?.border ? 'border' : 'none'
    const radius = item.styles?.radius ?? item.styles?.border?.radius ?? 0
    return `rect:${background}:${border}:${radius}:${item.styles?.opacity ?? 1}`
  }

  if (item.type === 'border') return `border:${item.styles?.color ?? 'none'}:${item.styles?.width ?? 0}`
  if (item.type === 'text') return `text:${item.styles?.font?.family ?? 'sans'}:${item.styles?.font?.size ?? 12}:${item.styles?.font?.weight ?? 'normal'}`
  if (item.type === 'icon') return `icon:${typeof item.icon === 'string' ? item.icon : 'source'}`
  if (item.type === 'nine-slice-image') return `nine-slice-image:${typeof item.image === 'string' ? item.image : item.image.id}:${item.styles?.opacity ?? 1}`
  if (item.type === 'pattern-rect') return `pattern-rect:${item.pattern.type}:${item.pattern.shape ?? 'square'}:${item.pattern.color}:${item.styles?.opacity ?? 1}`

  return item.type
}

/**
 * Вычисляет nova render stream kind.
 */
export function resolveNovaRenderStreamKind(item: NovaSchemaItem<any>): NovaRenderStreamKind {
  if (item.type === 'rect') {
    const border = item.styles?.border
    const radius = item.styles?.radius ?? border?.radius ?? 0
    const borderWidth = border?.width ?? 0
    const background = item.styles?.background

    if (background && typeof background !== 'string') return 'texture-quad'
    return radius > 0 || borderWidth > 0 ? 'rounded-rect' : 'plain-rect'
  }

  if (item.type === 'border') return 'border'
  if (item.type === 'line') return 'line'
  if (item.type === 'circle') return 'circle'
  if (item.type === 'arc') return 'arc'
  if (item.type === 'polygon') return 'polygon'
  if (item.type === 'text') return 'text-run'
  if (item.type === 'icon') return 'icon'
  if (item.type === 'nine-slice-image') return 'nine-slice-image'
  if (item.type === 'pattern-rect') return 'pattern-rect'
  return 'cached-group'
}

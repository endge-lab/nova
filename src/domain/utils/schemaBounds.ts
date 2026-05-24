import type { NovaBounds, NovaSchema } from '@/domain/types/renderer.types'
import { copyBounds, createEmptyBounds, setBounds, unionBounds } from '@/domain/utils/bounds'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'

/**
 * Считает локальные bounds по реальной render-schema.
 */
export function resolveSchemaBounds(schema: NovaSchema<any>, registry?: NovaSchemaRegistry): NovaBounds {
  let bounds = createEmptyBounds()
  let hasBounds = false

  for (const item of schema) {
    if (item.active === false) continue

    const itemBounds = resolveSchemaItemBounds(item, registry)
    if (!itemBounds) continue

    bounds = hasBounds ? unionBounds(bounds, itemBounds) : copyBounds(bounds, itemBounds)
    hasBounds = true
  }

  return bounds
}

/**
 * Вычисляет schema item bounds.
 */
export function resolveSchemaItemBounds(item: NovaSchema<any>[number], registry?: NovaSchemaRegistry): NovaBounds | null {
  switch (item.type) {
    case 'rect':
    case 'border':
    case 'text':
    case 'icon':
    case 'nine-slice-image':
      return setBounds(createEmptyBounds(), item.x, item.y, item.width, item.height)
    case 'circle':
      return setBounds(createEmptyBounds(), item.x - item.radius, item.y - item.radius, item.radius * 2, item.radius * 2)
    case 'arc': {
      const lineWidth = item.styles?.width ?? 1
      const size = item.radius * 2 + lineWidth
      return setBounds(createEmptyBounds(), item.x - item.radius - lineWidth / 2, item.y - item.radius - lineWidth / 2, size, size)
    }
    case 'line':
      return resolveLineBounds(item.x1, item.y1, item.x2, item.y2, item.styles?.width ?? 1)
    case 'polygon':
      return resolvePolygonBounds(item.points, item.styles?.lineWidth ?? 0)
    default:
      return registry?.resolve(item.type)?.measureBounds?.({ registry, depth: 0 }, item as any) ?? null
  }
}

/**
 * Вычисляет line bounds.
 */
function resolveLineBounds(x1: number, y1: number, x2: number, y2: number, width: number): NovaBounds {
  const pad = width / 2
  const minX = Math.min(x1, x2) - pad
  const minY = Math.min(y1, y2) - pad
  const maxX = Math.max(x1, x2) + pad
  const maxY = Math.max(y1, y2) + pad

  return setBounds(createEmptyBounds(), minX, minY, maxX - minX, maxY - minY)
}

/**
 * Вычисляет polygon bounds.
 */
function resolvePolygonBounds(points: Array<{ x: number; y: number }>, lineWidth: number): NovaBounds | null {
  if (points.length === 0) return null

  let minX = points[0].x
  let minY = points[0].y
  let maxX = points[0].x
  let maxY = points[0].y

  for (let index = 1; index < points.length; index++) {
    const point = points[index]
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  const pad = lineWidth / 2
  return setBounds(createEmptyBounds(), minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2)
}

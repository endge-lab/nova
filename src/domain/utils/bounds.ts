import type { NovaBounds } from '@/domain/types/renderer.types'
import type { mat3 } from 'gl-matrix'

/**
 * Создает empty bounds.
 */
export function createEmptyBounds(): NovaBounds {
  return { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * Выполняет публичную операцию transform bounds.
 */
export function transformBounds(bounds: NovaBounds, matrix: mat3): NovaBounds {
  const x1 = bounds.x
  const y1 = bounds.y
  const x2 = bounds.x + bounds.width
  const y2 = bounds.y + bounds.height

  const px1 = matrix[0] * x1 + matrix[3] * y1 + matrix[6]
  const py1 = matrix[1] * x1 + matrix[4] * y1 + matrix[7]
  const px2 = matrix[0] * x2 + matrix[3] * y1 + matrix[6]
  const py2 = matrix[1] * x2 + matrix[4] * y1 + matrix[7]
  const px3 = matrix[0] * x1 + matrix[3] * y2 + matrix[6]
  const py3 = matrix[1] * x1 + matrix[4] * y2 + matrix[7]
  const px4 = matrix[0] * x2 + matrix[3] * y2 + matrix[6]
  const py4 = matrix[1] * x2 + matrix[4] * y2 + matrix[7]
  const minX = Math.min(px1, px2, px3, px4)
  const minY = Math.min(py1, py2, py3, py4)
  const maxX = Math.max(px1, px2, px3, px4)
  const maxY = Math.max(py1, py2, py3, py4)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Выполняет публичную операцию union bounds.
 */
export function unionBounds(a: NovaBounds, b: NovaBounds): NovaBounds {
  if (a.width <= 0 && a.height <= 0) return { ...b }
  if (b.width <= 0 && b.height <= 0) return { ...a }

  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

/**
 * Обновляет bounds.
 */
export function setBounds(target: NovaBounds, x: number, y: number, width: number, height: number): NovaBounds {
  target.x = x
  target.y = y
  target.width = width
  target.height = height
  return target
}

/**
 * Копирует bounds.
 */
export function copyBounds(target: NovaBounds, source: NovaBounds): NovaBounds {
  target.x = source.x
  target.y = source.y
  target.width = source.width
  target.height = source.height
  return target
}

/**
 * Выполняет публичную операцию bounds equals.
 */
export function boundsEquals(a: NovaBounds, b: NovaBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Выполняет публичную операцию bounds intersects.
 */
export function boundsIntersects(a: NovaBounds, b: NovaBounds): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false

  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  )
}

/**
 * Выполняет публичную операцию bounds contains point.
 */
export function boundsContainsPoint(bounds: NovaBounds, x: number, y: number): boolean {
  return (
    x >= bounds.x
    && y >= bounds.y
    && x <= bounds.x + bounds.width
    && y <= bounds.y + bounds.height
  )
}

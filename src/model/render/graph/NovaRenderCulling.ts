import type { NovaRenderGroup, NovaRenderViewport } from '@/domain/types/rendering/index'
import type { NovaBounds } from '@/domain/types/renderer.types'

/**
 * Описывает контракт NovaRenderCullingResult.
 */
export interface NovaRenderCullingResult {
  testedGroups: number
  visibleGroups: NovaRenderGroup[]
  culledGroupIds: string[]
}

/**
 * Выполняет публичную операцию nova bounds intersects.
 */
export function novaBoundsIntersects(a: NovaBounds, b: NovaBounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

/**
 * Выполняет публичную операцию nova viewport to bounds.
 */
export function novaViewportToBounds(viewport: NovaRenderViewport): NovaBounds {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  }
}

/**
 * Проверяет nova render group visible.
 */
export function isNovaRenderGroupVisible(group: NovaRenderGroup, viewport: NovaRenderViewport): boolean {
  if (group.visible === false) return false
  const bounds = group.chunkBounds ?? group.bounds
  if (!bounds) return true
  return novaBoundsIntersects(bounds, novaViewportToBounds(viewport))
}

/**
 * Выполняет публичную операцию collect visible nova render groups.
 */
export function collectVisibleNovaRenderGroups(groups: Iterable<NovaRenderGroup>, viewport: NovaRenderViewport): NovaRenderCullingResult {
  const visibleGroups: NovaRenderGroup[] = []
  const culledGroupIds: string[] = []
  let testedGroups = 0

  for (const group of groups) {
    testedGroups += 1
    if (isNovaRenderGroupVisible(group, viewport)) {
      visibleGroups.push(group)
      continue
    }

    culledGroupIds.push(group.id)
  }

  return {
    testedGroups,
    visibleGroups,
    culledGroupIds,
  }
}

import type { NovaRenderGroup, NovaRenderViewport } from '@/domain/types/rendering/index'
import type { NovaBounds } from '@/domain/types/renderer-types'

export interface NovaRenderCullingResult {
  testedGroups: number
  visibleGroups: NovaRenderGroup[]
  culledGroupIds: string[]
}

export function novaBoundsIntersects(a: NovaBounds, b: NovaBounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

export function novaViewportToBounds(viewport: NovaRenderViewport): NovaBounds {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  }
}

export function isNovaRenderGroupVisible(group: NovaRenderGroup, viewport: NovaRenderViewport): boolean {
  if (group.visible === false) return false
  const bounds = group.chunkBounds ?? group.bounds
  if (!bounds) return true
  return novaBoundsIntersects(bounds, novaViewportToBounds(viewport))
}

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

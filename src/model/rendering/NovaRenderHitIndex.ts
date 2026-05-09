import type { NovaBounds } from '@/domain/types/renderer-types'
import { novaBoundsIntersects } from '@/model/rendering/NovaRenderCulling'

export type NovaRenderHitIndexPolicy = 'grid' | 'rbush' | 'row-interval'

export interface NovaRenderHitEntry<T = unknown> {
  id: string
  bounds: NovaBounds
  order: number
  payload?: T
}

export class NovaRenderHitIndex<T = unknown> {
  private readonly _entries = new Map<string, NovaRenderHitEntry<T>>()

  constructor(readonly policy: NovaRenderHitIndexPolicy = 'grid') {}

  get size(): number {
    return this._entries.size
  }

  set(entry: NovaRenderHitEntry<T>): void {
    this._entries.set(entry.id, entry)
  }

  delete(id: string): boolean {
    return this._entries.delete(id)
  }

  queryPoint(x: number, y: number): NovaRenderHitEntry<T> | undefined {
    let top: NovaRenderHitEntry<T> | undefined
    for (const entry of this._entries.values()) {
      if (
        x < entry.bounds.x
        || y < entry.bounds.y
        || x > entry.bounds.x + entry.bounds.width
        || y > entry.bounds.y + entry.bounds.height
      ) {
        continue
      }

      if (!top || entry.order >= top.order) top = entry
    }

    return top
  }

  queryBounds(bounds: NovaBounds): NovaRenderHitEntry<T>[] {
    const result: NovaRenderHitEntry<T>[] = []
    for (const entry of this._entries.values()) {
      if (novaBoundsIntersects(entry.bounds, bounds)) result.push(entry)
    }
    return result.sort((a, b) => a.order - b.order)
  }

  clear(): void {
    this._entries.clear()
  }
}

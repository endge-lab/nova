import type { NovaBounds } from '@/domain/types/renderer.types'
import { novaBoundsIntersects } from '@/model/render/graph/NovaRenderCulling'

/**
 * Описывает тип NovaRenderHitIndexPolicy.
 */
export type NovaRenderHitIndexPolicy = 'grid' | 'rbush' | 'row-interval'

/**
 * Описывает контракт NovaRenderHitEntry.
 */
export interface NovaRenderHitEntry<T = unknown> {
  id: string
  bounds: NovaBounds
  order: number
  payload?: T
}

/**
 * Хранит hit-test entries render graph и выполняет queries по policy.
 */
export class NovaRenderHitIndex<T = unknown> {
  private readonly _entries = new Map<string, NovaRenderHitEntry<T>>()

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(readonly policy: NovaRenderHitIndexPolicy = 'grid') {}

  /**
   * Возвращает size.
   */
  get size(): number {
    return this._entries.size
  }

  /**
   * Выполняет внутреннюю операцию set.
   */
  set(entry: NovaRenderHitEntry<T>): void {
    this._entries.set(entry.id, entry)
  }

  /**
   * Выполняет внутреннюю операцию delete.
   */
  delete(id: string): boolean {
    return this._entries.delete(id)
  }

  /**
   * Выполняет query point.
   */
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

  /**
   * Выполняет query bounds.
   */
  queryBounds(bounds: NovaBounds): NovaRenderHitEntry<T>[] {
    const result: NovaRenderHitEntry<T>[] = []
    for (const entry of this._entries.values()) {
      if (novaBoundsIntersects(entry.bounds, bounds)) result.push(entry)
    }
    return result.sort((a, b) => a.order - b.order)
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._entries.clear()
  }
}

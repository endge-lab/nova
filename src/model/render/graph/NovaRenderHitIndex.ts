import type { NovaBounds } from '@/domain/types/renderer.types'
import { NovaHitIndex } from '@/model/runtime/interaction/NovaHitIndex'

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
  private readonly _index = new NovaHitIndex<NovaRenderHitEntry<T>>({
    getBounds: entry => entry.bounds,
  })

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(readonly policy: NovaRenderHitIndexPolicy = 'grid') {}

  /**
   * Возвращает фактическую policy индекса.
   */
  get effectivePolicy(): 'rbush' {
    return 'rbush'
  }

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
    const previous = this._entries.get(entry.id)
    if (previous) this._index.remove(previous)
    this._entries.set(entry.id, entry)
    this._index.update(entry)
  }

  /**
   * Выполняет внутреннюю операцию delete.
   */
  delete(id: string): boolean {
    const entry = this._entries.get(id)
    if (!entry) return false

    this._index.remove(entry)
    return this._entries.delete(id)
  }

  /**
   * Выполняет query point.
   */
  queryPoint(x: number, y: number): NovaRenderHitEntry<T> | undefined {
    let top: NovaRenderHitEntry<T> | undefined
    for (const entry of this._index.queryPoint(x, y)) {
      if (!top || entry.order >= top.order) top = entry
    }

    return top
  }

  /**
   * Выполняет query bounds.
   */
  queryBounds(bounds: NovaBounds): Array<NovaRenderHitEntry<T>> {
    return this._index.queryBounds(bounds).sort((a, b) => a.order - b.order)
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._entries.clear()
    this._index.clear()
  }
}

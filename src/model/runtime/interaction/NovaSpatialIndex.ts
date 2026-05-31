import type { EventList } from '@endge/utils'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaBounds } from '@/domain/types/renderer.types'
import { NovaHitIndex } from '@/model/runtime/interaction/NovaHitIndex'

/**
 * Совместимый facade над RBush-backed hit-test индексом.
 */
export class NovaSpatialIndex<E extends EventList> {
  private readonly _index = new NovaHitIndex<NovaNode<E>>({
    getBounds: node => node.getRenderBounds(),
    isIndexable: node => node.active && node.visible,
  })

  /**
   * Создает instance. cellSize сохранен только для обратной совместимости.
   */
  constructor(_cellSize = 128) {}

  /**
   * Выполняет внутреннюю операцию rebuild.
   */
  rebuild(nodes: Iterable<NovaNode<E>>): void {
    this._index.rebuild(nodes)
  }

  /**
   * Выполняет query point.
   */
  queryPoint(x: number, y: number): Array<NovaNode<E>> {
    return this._index.queryPoint(x, y)
  }

  /**
   * Выполняет query bounds.
   */
  queryBounds(bounds: NovaBounds): Array<NovaNode<E>> {
    return this._index.queryBounds(bounds)
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._index.clear()
  }

  /**
   * Выполняет внутреннюю операцию update.
   */
  update(node: NovaNode<E>): void {
    this._index.update(node)
  }

  /**
   * Выполняет внутреннюю операцию remove.
   */
  remove(node: NovaNode<E>): void {
    this._index.remove(node)
  }

  /**
   * Возвращает условный cell count для старого diagnostics API.
   */
  get cellCount(): number {
    return this._index.indexedNodeCount
  }

  /**
   * Возвращает indexed node count.
   */
  get indexedNodeCount(): number {
    return this._index.indexedNodeCount
  }

  /**
   * Возвращает количество candidates в последнем query.
   */
  get lastQueryCandidateCount(): number {
    return this._index.lastQueryCandidateCount
  }
}

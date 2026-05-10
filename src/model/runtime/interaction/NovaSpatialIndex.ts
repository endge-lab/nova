import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaBounds } from '@/domain/types/renderer.types'
import type { EventList } from '@endge/utils'

const DEFAULT_CELL_SIZE = 128

/**
 * Хранит spatial index интерактивных nodes для ускоренного hit-test.
 */
export class NovaSpatialIndex<E extends EventList> {
  private readonly _cells = new Map<string, Set<NovaNode<E>>>()
  private readonly _nodeKeys = new Map<NovaNode<E>, Set<string>>()
  private readonly _cellSize: number

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this._cellSize = cellSize
  }

  /**
   * Выполняет внутреннюю операцию rebuild.
   */
  rebuild(nodes: Iterable<NovaNode<E>>): void {
    this.clear()

    for (const node of nodes) {
      this.update(node)
    }
  }

  /**
   * Выполняет query point.
   */
  queryPoint(x: number, y: number): Array<NovaNode<E>> {
    const key = this.keyForPoint(x, y)
    const nodes = this._cells.get(key)
    if (!nodes) return []

    return [...nodes]
  }

  /**
   * Выполняет query bounds.
   */
  queryBounds(bounds: NovaBounds): Array<NovaNode<E>> {
    if (bounds.width <= 0 || bounds.height <= 0) return []

    const minX = Math.floor(bounds.x / this._cellSize)
    const minY = Math.floor(bounds.y / this._cellSize)
    const maxX = Math.floor((bounds.x + bounds.width) / this._cellSize)
    const maxY = Math.floor((bounds.y + bounds.height) / this._cellSize)
    const result = new Set<NovaNode<E>>()

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = this._cells.get(`${x}:${y}`)
        if (!cell) continue

        for (const node of cell) {
          result.add(node)
        }
      }
    }

    return [...result]
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._cells.clear()
    this._nodeKeys.clear()
  }

  /**
   * Выполняет внутреннюю операцию update.
   */
  update(node: NovaNode<E>): void {
    this.remove(node)
    if (!node.active || !node.visible) return
    this.insert(node, node.getRenderBounds())
  }

  /**
   * Выполняет внутреннюю операцию remove.
   */
  remove(node: NovaNode<E>): void {
    const keys = this._nodeKeys.get(node)
    if (!keys) return

    for (const key of keys) {
      const cell = this._cells.get(key)
      if (!cell) continue

      cell.delete(node)
      if (cell.size === 0) this._cells.delete(key)
    }

    this._nodeKeys.delete(node)
  }

  /**
   * Выполняет внутреннюю операцию insert.
   */
  private insert(node: NovaNode<E>, bounds: NovaBounds): void {
    if (bounds.width <= 0 || bounds.height <= 0) return

    const minX = Math.floor(bounds.x / this._cellSize)
    const minY = Math.floor(bounds.y / this._cellSize)
    const maxX = Math.floor((bounds.x + bounds.width) / this._cellSize)
    const maxY = Math.floor((bounds.y + bounds.height) / this._cellSize)
    const nodeKeys = new Set<string>()

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x}:${y}`
        nodeKeys.add(key)
        let cell = this._cells.get(key)
        if (!cell) {
          cell = new Set()
          this._cells.set(key, cell)
        }
        cell.add(node)
      }
    }

    if (nodeKeys.size > 0) this._nodeKeys.set(node, nodeKeys)
  }

  /**
   * Выполняет внутреннюю операцию key for point.
   */
  private keyForPoint(x: number, y: number): string {
    return `${Math.floor(x / this._cellSize)}:${Math.floor(y / this._cellSize)}`
  }

  /**
   * Возвращает cell count.
   */
  get cellCount(): number {
    return this._cells.size
  }

  /**
   * Возвращает indexed node count.
   */
  get indexedNodeCount(): number {
    return this._nodeKeys.size
  }
}

import type { NovaNode } from '@/model/core/NovaNode'
import type { NovaBounds } from '@/domain/types/renderer-types'
import type { EventList } from '@endge/utils'

const DEFAULT_CELL_SIZE = 128

export class NovaSpatialIndex<E extends EventList> {
  private readonly _cells = new Map<string, Set<NovaNode<E>>>()
  private readonly _nodeKeys = new Map<NovaNode<E>, Set<string>>()
  private readonly _cellSize: number

  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this._cellSize = cellSize
  }

  rebuild(nodes: Iterable<NovaNode<E>>): void {
    this.clear()

    for (const node of nodes) {
      this.update(node)
    }
  }

  queryPoint(x: number, y: number): Array<NovaNode<E>> {
    const key = this.keyForPoint(x, y)
    const nodes = this._cells.get(key)
    if (!nodes) return []

    return [...nodes]
  }

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

  clear(): void {
    this._cells.clear()
    this._nodeKeys.clear()
  }

  update(node: NovaNode<E>): void {
    this.remove(node)
    if (!node.active || !node.visible) return
    this.insert(node, node.getRenderBounds())
  }

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

  private keyForPoint(x: number, y: number): string {
    return `${Math.floor(x / this._cellSize)}:${Math.floor(y / this._cellSize)}`
  }

  get cellCount(): number {
    return this._cells.size
  }

  get indexedNodeCount(): number {
    return this._nodeKeys.size
  }
}

import type { NovaBounds } from '@/domain/types/renderer.types'
import RBush from 'rbush'

/**
 * Описывает indexed record для RBush.
 */
interface NovaHitIndexRecord<T> {
  minX: number
  minY: number
  maxX: number
  maxY: number
  item: T
}

/**
 * Описывает options общего hit-test индекса.
 */
export interface NovaHitIndexOptions<T> {
  getBounds: (item: T) => NovaBounds
  isIndexable?: (item: T) => boolean
}

/**
 * Хранит RBush-backed индекс для point и bounds queries.
 */
export class NovaHitIndex<T extends object> {
  private readonly _tree = new RBush<NovaHitIndexRecord<T>>()
  private readonly _records = new Map<T, NovaHitIndexRecord<T>>()
  private _lastQueryCandidateCount = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(private readonly _options: NovaHitIndexOptions<T>) {}

  /**
   * Полностью пересобирает индекс.
   */
  rebuild(items: Iterable<T>): void {
    this.clear()

    const records: Array<NovaHitIndexRecord<T>> = []
    for (const item of items) {
      const record = this._createRecord(item)
      if (!record) {
        continue
      }

      this._records.set(item, record)
      records.push(record)
    }

    if (records.length > 0) {
      this._tree.load(records)
    }
  }

  /**
   * Выполняет point query.
   */
  queryPoint(x: number, y: number): Array<T> {
    const records = this._tree
      .search({ minX: x, minY: y, maxX: x, maxY: y })
    this._lastQueryCandidateCount = records.length
    return records.map(record => record.item)
  }

  /**
   * Выполняет bounds query.
   */
  queryBounds(bounds: NovaBounds): Array<T> {
    if (bounds.width <= 0 || bounds.height <= 0) {
      this._lastQueryCandidateCount = 0
      return []
    }

    const records = this._tree
      .search({
        minX: bounds.x,
        minY: bounds.y,
        maxX: bounds.x + bounds.width,
        maxY: bounds.y + bounds.height,
      })
    this._lastQueryCandidateCount = records.length
    return records.map(record => record.item)
  }

  /**
   * Обновляет один item в индексе.
   */
  update(item: T): void {
    this.remove(item)

    const record = this._createRecord(item)
    if (!record) {
      return
    }

    this._records.set(item, record)
    this._tree.insert(record)
  }

  /**
   * Удаляет item из индекса.
   */
  remove(item: T): void {
    const record = this._records.get(item)
    if (!record) {
      return
    }

    this._tree.remove(record)
    this._records.delete(item)
  }

  /**
   * Очищает индекс.
   */
  clear(): void {
    this._tree.clear()
    this._records.clear()
    this._lastQueryCandidateCount = 0
  }

  /**
   * Возвращает количество проиндексированных items.
   */
  get indexedNodeCount(): number {
    return this._records.size
  }

  /**
   * Возвращает количество RBush candidates в последнем query.
   */
  get lastQueryCandidateCount(): number {
    return this._lastQueryCandidateCount
  }

  /**
   * Создает RBush record для item.
   */
  private _createRecord(item: T): NovaHitIndexRecord<T> | null {
    if (this._options.isIndexable && !this._options.isIndexable(item)) {
      return null
    }

    const bounds = this._options.getBounds(item)
    if (!isFiniteBounds(bounds) || bounds.width <= 0 || bounds.height <= 0) {
      return null
    }

    return {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
      item,
    }
  }
}

/**
 * Проверяет корректность bounds для индекса.
 */
function isFiniteBounds(bounds: NovaBounds): boolean {
  return Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
}

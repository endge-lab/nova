import type { ClassConstructor } from 'class-transformer'

/**
 * Хранит shared runtime-state, который используется сценами и surfaces.
 */
export class NovaStore {
  private _dataMap = new Map<string, any>()

  /**
   * Выполняет внутреннюю операцию set.
   */
  set<T>(key: string, data: T): void {
    this._dataMap.set(key, data)
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get<T>(key: string): T | undefined {
    return this._dataMap.get(key) as T | undefined
  }

  /**
   * Возвращает by type.
   */
  getByType<T>(type: ClassConstructor<T>): Array<T> {
    return Array.from(this._dataMap.values()).filter(
      (item): item is T => item instanceof type,
    )
  }

  /**
   * Выполняет внутреннюю операцию remove.
   */
  remove(key: string): void {
    const value = this._dataMap.get(key)
    if (value) {
      this._dataMap.delete(key)
    }
  }

  /**
   * Выполняет внутреннюю операцию update.
   */
  update<T>(key: string, newData: T): void {
    if (this._dataMap.has(key)) {
      this._dataMap.set(key, newData)
    }
  }
}

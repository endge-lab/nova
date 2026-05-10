import type { ClassConstructor } from 'class-transformer'

/**
 * Хранит shared runtime-state, который используется сценами и surfaces.
 */
export class NovaStore {
  private dataMap = new Map<string, any>()

  /**
   * Выполняет внутреннюю операцию set.
   */
  set<T>(key: string, data: T): void {
    this.dataMap.set(key, data)
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get<T>(key: string): T | undefined {
    return this.dataMap.get(key) as T | undefined
  }

  /**
   * Возвращает by type.
   */
  getByType<T>(type: ClassConstructor<T>): T[] {
    return Array.from(this.dataMap.values()).filter(
      (item): item is T => item instanceof type,
    )
  }

  /**
   * Выполняет внутреннюю операцию remove.
   */
  remove(key: string): void {
    const value = this.dataMap.get(key)
    if (value) {
      this.dataMap.delete(key)
    }
  }

  /**
   * Выполняет внутреннюю операцию update.
   */
  update<T>(key: string, newData: T): void {
    if (this.dataMap.has(key)) {
      this.dataMap.set(key, newData)
    }
  }
}

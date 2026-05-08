import type { ClassConstructor } from 'class-transformer'

export class NovaStore {
  private dataMap = new Map<string, any>()

  set<T>(key: string, data: T): void {
    this.dataMap.set(key, data)
  }

  get<T>(key: string): T | undefined {
    return this.dataMap.get(key) as T | undefined
  }

  getByType<T>(type: ClassConstructor<T>): T[] {
    return Array.from(this.dataMap.values()).filter(
      (item): item is T => item instanceof type,
    )
  }

  remove(key: string): void {
    const value = this.dataMap.get(key)
    if (value) {
      this.dataMap.delete(key)
    }
  }

  update<T>(key: string, newData: T): void {
    if (this.dataMap.has(key)) {
      this.dataMap.set(key, newData)
    }
  }
}

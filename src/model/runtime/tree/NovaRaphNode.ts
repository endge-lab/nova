import type { NovaNodeProperties } from '@/domain/types/base.types'
import type { NovaRaphRuntime } from '@/model/runtime/app/NovaRaphRuntime'

let nextNodeId = 0

/**
 * Scene-node storage and mutable parentage owned by Nova.
 */
export class NovaRaphNode<P extends NovaNodeProperties = NovaNodeProperties> {
  readonly id = `node-${nextNodeId++}`
  readonly children: Array<NovaRaphNode<P>> = []
  readonly meta: Record<string, unknown> = {}
  readonly type = 'default'
  parent: NovaRaphNode<P> | null = null
  private readonly _values: Partial<P> = {}
  private readonly _ownedStops: Array<() => void> = []
  private _weight = 0
  private _disposed = false

  constructor(private readonly _raphRuntime: NovaRaphRuntime<P>) {}

  get app(): NovaRaphRuntime<P> { return this._raphRuntime }
  get raph(): NovaRaphRuntime<P> { return this._raphRuntime }
  get weight(): number { return this._weight }
  get computedWeight(): number { return this._raphRuntime.priorityOf(this) }

  get<K extends keyof P>(key: K): P[K] {
    return this._raphRuntime.getLocalProperty(key)?.get(this) ?? this.getLocal(key)
  }

  set<K extends keyof P>(key: K, value: P[K]): void {
    const property = this._raphRuntime.getLocalProperty(key)
    if (property) {
      property.set(this, value)
    }
    else { this.setLocal(key, value) }
  }

  getLocal<K extends keyof P>(key: K): P[K] {
    return this._values[key] as P[K]
  }

  setLocal<K extends keyof P>(key: K, value: P[K]): void {
    this._values[key] = value
  }

  get local(): { get: <K extends keyof P>(key: K) => P[K], set: <K extends keyof P>(key: K, value: P[K]) => void } {
    return { get: key => this.getLocal(key), set: (key, value) => this.setLocal(key, value) }
  }

  options(values: Partial<P> & { weight?: number, zIndex?: number }): this {
    if (values.weight !== undefined) { this._weight = values.weight }
    if (values.zIndex !== undefined) { this._weight = values.zIndex }
    for (const key of Object.keys(values) as Array<keyof P>) {
      if (key === 'weight' || key === 'zIndex') { continue }
      const value = values[key]
      if (value !== undefined) { this.set(key, value as P[typeof key]) }
    }
    return this
  }

  addChild(node: NovaRaphNode<P>, options: { invalidate?: boolean } = {}): boolean {
    if (this.children.includes(node)) { return true }
    if (node.parent) {
      const previous = node.parent.children
      const index = previous.indexOf(node)
      if (index >= 0) { previous.splice(index, 1) }
    }
    node.parent = this
    this.children.push(node)
    this._raphRuntime.dirtyNodeDefaults(node, options.invalidate ?? true)
    return true
  }

  remove(): void {
    this.dispose()
  }

  traverseAll(visit: (node: NovaRaphNode<P>) => void): void {
    visit(this)
    for (const child of this.children) { child.traverseAll(visit) }
  }

  own(dispose: () => void): void {
    this._ownedStops.push(dispose)
  }

  dispose(): void {
    if (this._disposed) { return }
    this._disposed = true
    for (const child of [...this.children]) { child.dispose() }
    this.children.length = 0
    for (const dispose of this._ownedStops.splice(0)) { dispose() }
    if (this.parent) {
      const siblings = this.parent.children
      const index = siblings.indexOf(this)
      if (index >= 0) { siblings.splice(index, 1) }
      this.parent = null
    }
    this._raphRuntime.forget(this)
  }
}

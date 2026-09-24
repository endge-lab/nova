import type { DataPathDef, RaphKernel } from '@raphy-js/raph/path'
import type { FrameLoopLease, RaphFrameContext, RaphSchedulerMode } from '@raphy-js/raph/runtime'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import type { NovaRaphPropagation, NovaRaphPropertyDescriptor } from '@/model/runtime/app/nova-raph-metadata'
import { DataPath } from '@raphy-js/raph/path'
import { RaphRuntime } from '@raphy-js/raph/runtime'
import { NovaRaphNode } from '@/model/runtime/tree/NovaRaphNode'

export interface NovaRaphProperty<P extends NovaNodeProperties, K extends keyof P = keyof P> {
  readonly name: K
  readonly phase: string
  readonly propagation: NovaRaphPropagation
  readonly dependsOn: Array<keyof P>
  get: (node: NovaRaphNode<P>) => P[K]
  set: (node: NovaRaphNode<P>, value: P[K]) => void
  computeOn: (node: NovaRaphNode<P>) => void
}

export interface NovaRaphPhase<P extends NovaNodeProperties> {
  readonly name: string
  readonly mode: 'dirty' | 'all'
  readonly always: boolean
  readonly priority: number
  readonly properties: Array<NovaRaphProperty<P>>
  readonly process: (payload: NovaRaphPhaseContext<P>) => void
  afterProcess?: (node: NovaRaphNode<P>, phase: NovaRaphPhase<P>) => void
}

export interface NovaRaphPhaseContext<P extends NovaNodeProperties = NovaNodeProperties> {
  phase: NovaRaphPhase<P>
  frame: RaphFrameContext
  root: NovaRaphNode<P>
  dirty: Array<NovaRaphNode<P>>
  events?: ReadonlyMap<NovaRaphNode<P>, readonly unknown[]>
}

/**
 * Bridges Nova's scene-owned dirty lanes to one Raph Next execution graph.
 */
export class NovaRaphRuntime<P extends NovaNodeProperties = NovaNodeProperties> {
  readonly id: string
  readonly core: RaphRuntime
  readonly root: NovaRaphNode<P>
  readonly kernel: RaphKernel
  private readonly _revision
  private readonly _phases: Array<NovaRaphPhase<P>> = []
  private readonly _phaseByName = new Map<string, NovaRaphPhase<P>>()
  private readonly _properties = new Map<keyof P, NovaRaphProperty<P>>()
  private readonly _dirty = new Map<string, Set<NovaRaphNode<P>>>()
  private readonly _events = new Map<string, Map<NovaRaphNode<P>, unknown[]>>()
  private _frame = 0
  private _firstFrameAt = 0
  private _lastFrameAt = 0
  private _ups = 0
  private _upsCount = 0
  private _upsAt = 0
  private _loopEnabled = false
  private _running = false
  private _dataInvalidationScheduled = false
  private _disposed = false

  constructor(options: { id?: string, kernel?: RaphKernel, scheduler: RaphSchedulerMode }) {
    this.id = options.id ?? 'nova'
    this.core = new RaphRuntime(options)
    this.kernel = this.core.kernel
    this.root = new NovaRaphNode<P>(this)
    this._revision = this.core.signal(0)
  }

  get UPS(): number { return this._ups }
  get loopEnabled(): boolean { return this._loopEnabled }

  init(phases: Array<NovaRaphPhase<P>>, descriptors: NovaRaphPropertyDescriptor[]): void {
    this._phases.push(...phases.sort((a, b) => a.priority - b.priority))
    for (const phase of this._phases) { this._phaseByName.set(phase.name, phase) }
    for (const descriptor of descriptors) {
      const phase = this._phaseByName.get(descriptor.phase)
      if (!phase) { throw new Error(`[Nova] Missing phase ${descriptor.phase}`) }
      const property = this._createProperty(descriptor)
      phase.properties.push(property)
      this._properties.set(property.name, property)
    }
    for (const phase of this._phases) { this._sortProperties(phase) }
    this.dirtyNodeDefaults(this.root, false)
  }

  activate(): void {
    this.core.definePhases([{ name: 'nova-frame', traversal: 'dirty-only', mode: 'always', each: () => {} }])
    this.core.effect('nova-frame', () => {
      this._revision.get()
      this._processFrame()
    })
  }

  getLocalProperty<K extends keyof P>(key: K): NovaRaphProperty<P, K> | undefined {
    return this._properties.get(key) as NovaRaphProperty<P, K> | undefined
  }

  getPhase(name: string): NovaRaphPhase<P> | undefined {
    return this._phaseByName.get(name)
  }

  addNode(node: NovaRaphNode<P>): void {
    this.root.addChild(node)
  }

  dirtyNodeDefaults(node: NovaRaphNode<P>, invalidate = true): void {
    for (const property of this._properties.values()) { this.dirty(property.phase, node, { invalidate: false }) }
    if (invalidate) { this.invalidate() }
  }

  dirty(phase: string, node: NovaRaphNode<P>, options: { invalidate?: boolean, event?: unknown } = {}): void {
    if (this._disposed) { return }
    if (!this._phaseByName.has(phase)) { return }
    let nodes = this._dirty.get(phase)
    if (!nodes) { this._dirty.set(phase, nodes = new Set()) }
    nodes.add(node)
    if (options.event !== undefined) {
      let byNode = this._events.get(phase)
      if (!byNode) { this._events.set(phase, byNode = new Map()) }
      const events = byNode.get(node) ?? []
      events.push(options.event)
      byNode.set(node, events)
    }
    if (options.invalidate !== false) { this.invalidate() }
  }

  invalidate(): void {
    if (this._disposed) { return }
    this._revision.set(this._revision.peek() + 1)
  }

  run(): void {
    if (this._disposed) { return }
    if ([...this._dirty.values()].some(nodes => nodes.size > 0)) { this.invalidate() }
    this.core.flush()
  }

  observeData(node: NovaRaphNode<P>, path: DataPathDef, options: { phase: string, traversal?: 'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all', vars?: Record<string, unknown>, wildcardDynamic?: boolean }): () => void {
    const mask = DataPath.from(path, { vars: options.vars, wildcardDynamic: options.wildcardDynamic })
    const stop = this.kernel.watch(mask, (payload) => {
      const traversal = options.traversal ?? 'dirty-only'
      if (traversal === 'dirty-and-down') {
        node.traverseAll(item => this.dirty(options.phase, item, { event: payload, invalidate: false }))
      }
      else if (traversal === 'dirty-and-up') {
        for (let current: NovaRaphNode<P> | null = node; current; current = current.parent) {
          this.dirty(options.phase, current, { event: payload, invalidate: false })
        }
      }
      else if (traversal === 'all') {
        this.root.traverseAll(item => this.dirty(options.phase, item, { event: payload, invalidate: false }))
      }
      else {
        this.dirty(options.phase, node, { event: payload, invalidate: false })
      }
      if (this._dataInvalidationScheduled) { return }
      this._dataInvalidationScheduled = true
      queueMicrotask(() => {
        this._dataInvalidationScheduled = false
        if ([...this._dirty.values()].some(nodes => nodes.size > 0)) { this.invalidate() }
      })
    })
    node.own(stop)
    return stop
  }

  acquireLoop(owner: string): FrameLoopLease {
    return this.core.acquireLoop(owner)
  }

  startLoop(): void {
    this._loopEnabled = true
    this.core.startLoop()
  }

  stopLoop(): void {
    this._loopEnabled = false
    this.core.stopLoop()
  }

  clearDirtyQueues(): void {
    this._dirty.clear()
    this._events.clear()
  }

  forget(node: NovaRaphNode<P>): void {
    for (const nodes of this._dirty.values()) { nodes.delete(node) }
    for (const events of this._events.values()) { events.delete(node) }
  }

  priorityOf(node: NovaRaphNode<P>): number {
    let depth = 0
    for (let parent = node.parent; parent; parent = parent.parent) { depth++ }
    return depth * 1_048_576 + node.weight
  }

  clear(): void {
    if (this._disposed) { return }
    this._disposed = true
    this.root.dispose()
    this.core.dispose()
    this.clearDirtyQueues()
  }

  private _createProperty(descriptor: NovaRaphPropertyDescriptor): NovaRaphProperty<P> {
    const key = descriptor.name as keyof P
    const defaultValue = descriptor.defaultValue as P[typeof key]
    return {
      name: key,
      phase: descriptor.phase,
      propagation: descriptor.propagation,
      dependsOn: descriptor.dependsOn as Array<keyof P>,
      get: node => node.getLocal(key) ?? defaultValue,
      set: (node, value) => {
        node.setLocal(key, value)
        this.dirty(descriptor.phase, node)
      },
      computeOn: (node) => {
        const value = descriptor.compute
          ? descriptor.compute(node as unknown as import('@/model/runtime/tree/NovaNode').NovaNode<any>)
          : node.getLocal(key) ?? defaultValue
        node.setLocal(key, value as P[typeof key])
      },
    }
  }

  private _sortProperties(phase: NovaRaphPhase<P>): void {
    const byName = new Map(phase.properties.map(property => [property.name, property]))
    const visited = new Set<keyof P>()
    const sorted: Array<NovaRaphProperty<P>> = []
    const visit = (property: NovaRaphProperty<P>): void => {
      if (visited.has(property.name)) { return }
      visited.add(property.name)
      for (const key of property.dependsOn) {
        const dependency = byName.get(key)
        if (dependency) { visit(dependency) }
      }
      sorted.push(property)
    }
    for (const property of phase.properties) { visit(property) }
    phase.properties.splice(0, phase.properties.length, ...sorted)
  }

  private _processFrame(): void {
    if (this._running) { return }
    this._running = true
    try {
      const now = performance.now()
      if (this._firstFrameAt === 0) { this._firstFrameAt = now }
      const frame: RaphFrameContext = {
        now,
        delta: this._lastFrameAt === 0 ? 0 : Math.min(100, now - this._lastFrameAt),
        elapsed: now - this._firstFrameAt,
        frame: this._frame++,
      }
      this._lastFrameAt = now
      this._upsCount++
      if (now - this._upsAt >= 1000) {
        this._ups = this._upsCount
        this._upsCount = 0
        this._upsAt = now
      }
      for (const phase of this._phases) {
        const direct = this._dirty.get(phase.name)
        if ((!direct || direct.size === 0) && !phase.always) { continue }
        this._dirty.delete(phase.name)
        const events = this._events.get(phase.name)
        this._events.delete(phase.name)
        const expanded = new Set<NovaRaphNode<P>>()
        if (phase.mode === 'all' && direct?.size) {
          this.root.traverseAll(node => expanded.add(node))
        }
        else if (phase.properties.some(property => property.propagation === 'down')) {
          for (const node of direct ?? []) { node.traverseAll(child => expanded.add(child)) }
        }
        else {
          for (const node of direct ?? []) { expanded.add(node) }
        }
        const dirty = [...expanded].sort((a, b) => this.priorityOf(a) - this.priorityOf(b))
        phase.process({ phase, frame, root: this.root, dirty, events })
      }
    }
    finally {
      this._running = false
    }
    if ([...this._dirty.values()].some(nodes => nodes.size > 0)) { this.invalidate() }
  }
}

export function processDirtyNodes<P extends NovaNodeProperties>({ payload }: { payload: NovaRaphPhaseContext<P> }): void {
  for (const node of payload.dirty) {
    for (const property of payload.phase.properties) { property.computeOn(node) }
    payload.phase.afterProcess?.(node, payload.phase)
  }
}

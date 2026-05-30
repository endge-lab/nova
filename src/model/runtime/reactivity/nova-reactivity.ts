import type { NovaNode } from '@/model/runtime/tree/NovaNode'

type NovaReactiveSubscriber = NovaNode<any> | NovaComputedSubscriber

interface NovaReactiveSource {
  addSubscriber(subscriber: NovaReactiveSubscriber): void
  removeSubscriber(subscriber: NovaReactiveSubscriber): void
}

interface NovaComputedSubscriber extends NovaReactiveSource {
  addDependency(source: NovaReactiveSource): void
  markDirty(): void
}

interface NovaTrackingFrame {
  subscriber: NovaReactiveSubscriber
}

export interface NovaTrackNodeOptions {
  mode?: 'replace' | 'append'
}

export interface NovaReadableSignal<T> {
  readonly value: T
}

export interface NovaSignal<T> extends NovaReadableSignal<T> {
  value: T
}

export interface NovaComputed<T> extends NovaReadableSignal<T> {}

const trackingStack: Array<NovaTrackingFrame> = []
const nodeDependencies = new WeakMap<NovaNode<any>, Set<NovaReactiveSource>>()
const trackedNodes = new WeakSet<NovaNode<any>>()

/**
 * Creates a mutable Nova signal.
 */
export function createNovaSignal<T>(initialValue: T): NovaSignal<T> {
  return new NovaSignalImpl(initialValue)
}

/**
 * Creates a lazy Nova computed signal.
 */
export function createNovaComputed<T>(compute: () => T): NovaComputed<T> {
  return new NovaComputedImpl(compute)
}

/**
 * Tracks signal reads performed by a NovaNode update/template pass.
 */
export function trackNovaNode<T>(node: NovaNode<any>, callback: () => T, options: NovaTrackNodeOptions = {}): T {
  if (options.mode !== 'append') {
    cleanupNodeDependencies(node)
  }
  if (!trackedNodes.has(node)) {
    trackedNodes.add(node)
    node.addDisposer(() => cleanupNodeDependencies(node))
  }

  trackingStack.push({ subscriber: node })
  try {
    return callback()
  } finally {
    trackingStack.pop()
  }
}

function registerDependency(source: NovaReactiveSource): void {
  const frame = trackingStack[trackingStack.length - 1]
  if (!frame) return

  source.addSubscriber(frame.subscriber)
  if (isComputedSubscriber(frame.subscriber)) {
    frame.subscriber.addDependency(source)
    return
  }

  let dependencies = nodeDependencies.get(frame.subscriber)
  if (!dependencies) {
    dependencies = new Set()
    nodeDependencies.set(frame.subscriber, dependencies)
  }
  dependencies.add(source)
}

function cleanupNodeDependencies(node: NovaNode<any>): void {
  const dependencies = nodeDependencies.get(node)
  if (!dependencies) return

  for (const dependency of dependencies) {
    dependency.removeSubscriber(node)
  }
  dependencies.clear()
}

function notifySubscriber(subscriber: NovaReactiveSubscriber): void {
  if (isComputedSubscriber(subscriber)) {
    subscriber.markDirty()
    return
  }

  subscriber.dirty({ update: true, render: true })
  subscriber.nova.invalidate()
}

function isComputedSubscriber(subscriber: NovaReactiveSubscriber): subscriber is NovaComputedSubscriber {
  return subscriber instanceof NovaComputedImpl
}

class NovaSignalImpl<T> implements NovaSignal<T>, NovaReactiveSource {
  private subscribers = new Set<NovaReactiveSubscriber>()

  /**
   * Creates a mutable signal.
   */
  constructor(private currentValue: T) {}

  /**
   * Reads the signal value and registers a dependency when tracking is active.
   */
  get value(): T {
    registerDependency(this)
    return this.currentValue
  }

  /**
   * Updates the signal and invalidates dependent Nova nodes/computeds.
   */
  set value(nextValue: T) {
    if (Object.is(this.currentValue, nextValue)) return
    this.currentValue = nextValue
    this.notify()
  }

  /**
   * Adds a dependent node/computed.
   */
  addSubscriber(subscriber: NovaReactiveSubscriber): void {
    this.subscribers.add(subscriber)
  }

  /**
   * Removes a dependent node/computed.
   */
  removeSubscriber(subscriber: NovaReactiveSubscriber): void {
    this.subscribers.delete(subscriber)
  }

  /**
   * Invalidates all dependents.
   */
  protected notify(): void {
    for (const subscriber of [...this.subscribers]) {
      notifySubscriber(subscriber)
    }
  }
}

class NovaComputedImpl<T> implements NovaComputed<T>, NovaComputedSubscriber {
  private subscribers = new Set<NovaReactiveSubscriber>()
  private dependencies = new Set<NovaReactiveSource>()
  private dirty = true
  private currentValue!: T

  /**
   * Creates a lazy computed signal.
   */
  constructor(private readonly compute: () => T) {}

  /**
   * Reads the computed value and registers it as a dependency.
   */
  get value(): T {
    registerDependency(this)
    if (this.dirty) this.recompute()
    return this.currentValue
  }

  /**
   * Adds a dependent node/computed.
   */
  addSubscriber(subscriber: NovaReactiveSubscriber): void {
    this.subscribers.add(subscriber)
  }

  /**
   * Removes a dependent node/computed.
   */
  removeSubscriber(subscriber: NovaReactiveSubscriber): void {
    this.subscribers.delete(subscriber)
  }

  /**
   * Records a source read while this computed is being evaluated.
   */
  addDependency(source: NovaReactiveSource): void {
    this.dependencies.add(source)
  }

  /**
   * Marks this computed as dirty and invalidates downstream dependents.
   */
  markDirty(): void {
    if (this.dirty) return
    this.dirty = true
    for (const subscriber of [...this.subscribers]) {
      notifySubscriber(subscriber)
    }
  }

  private recompute(): void {
    this.cleanupDependencies()
    trackingStack.push({ subscriber: this })
    try {
      this.currentValue = this.compute()
    } finally {
      trackingStack.pop()
      this.dirty = false
    }
  }

  private cleanupDependencies(): void {
    for (const dependency of this.dependencies) {
      dependency.removeSubscriber(this)
    }
    this.dependencies.clear()
  }
}

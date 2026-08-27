import type { NovaApp, NovaSurface } from '@/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Nova, NovaNode } from '@/index'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

class ReactiveTestNode extends NovaNode<Record<string, any>> {
  reads: Array<unknown> = []

  /**
   * Records a value during update.
   */
  read(value: unknown): void {
    this.reads.push(value)
  }
}

function createNode(): { app: NovaApp, surface: NovaSurface<Record<string, any>>, node: ReactiveTestNode } {
  const app = createTestApp()
  const surface = app.createSurface('reactivity')
  const node = new ReactiveTestNode(app, surface)
  return { app, surface, node }
}

beforeEach(() => {
  installCanvasMocks()
})

describe('nova reactivity', () => {
  it('reads and writes mutable signals', () => {
    const count = Nova.signal(0)

    expect(count.value).toBe(0)
    count.value = 2
    expect(count.value).toBe(2)
  })

  it('lazily recomputes computed signals when a source changes', () => {
    const count = Nova.signal(1)
    const compute = vi.fn(() => count.value * 2)
    const doubled = Nova.computed(compute)

    expect(compute).not.toHaveBeenCalled()
    expect(doubled.value).toBe(2)
    expect(compute).toHaveBeenCalledTimes(1)

    count.value = 3
    expect(compute).toHaveBeenCalledTimes(1)
    expect(doubled.value).toBe(6)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('invalidates nodes that read computed signals', () => {
    const count = Nova.signal(1)
    const doubled = Nova.computed(() => count.value * 2)
    const node = createNode().node
    const dirty = vi.spyOn(node, 'dirty')

    Nova.trackNode(node, () => node.read(doubled.value))
    dirty.mockClear()

    count.value = 2

    expect(dirty).toHaveBeenCalledWith({ update: true, render: true })
  })

  it('marks only dependent Nova nodes dirty when a signal changes', () => {
    const source = Nova.signal('#2563eb')
    const first = createNode()
    const second = createNode()
    const firstDirty = vi.spyOn(first.node, 'dirty')
    const secondDirty = vi.spyOn(second.node, 'dirty')
    const firstInvalidate = vi.spyOn(first.app, 'invalidate')
    const secondInvalidate = vi.spyOn(second.app, 'invalidate')

    Nova.trackNode(first.node, () => first.node.read(source.value))

    source.value = '#dc2626'

    expect(firstDirty).toHaveBeenCalledWith({ update: true, render: true })
    expect(firstInvalidate).toHaveBeenCalled()
    expect(secondDirty).not.toHaveBeenCalled()
    expect(secondInvalidate).not.toHaveBeenCalled()
  })

  it('replaces node dependencies after branch changes', () => {
    const primary = Nova.signal('primary')
    const secondary = Nova.signal('secondary')
    const node = createNode().node
    const dirty = vi.spyOn(node, 'dirty')
    let usePrimary = true

    Nova.trackNode(node, () => node.read(usePrimary ? primary.value : secondary.value))
    usePrimary = false
    Nova.trackNode(node, () => node.read(usePrimary ? primary.value : secondary.value))

    dirty.mockClear()
    primary.value = 'primary-next'
    expect(dirty).not.toHaveBeenCalled()

    secondary.value = 'secondary-next'
    expect(dirty).toHaveBeenCalledWith({ update: true, render: true })
  })

  it('unsubscribes disposed nodes from signal changes', () => {
    const source = Nova.signal(1)
    const node = createNode().node
    const dirty = vi.spyOn(node, 'dirty')

    Nova.trackNode(node, () => node.read(source.value))
    node.dispose()
    dirty.mockClear()

    source.value = 2
    expect(dirty).not.toHaveBeenCalled()
  })

  it('supports one imported signal across multiple Nova apps', () => {
    const source = Nova.signal(1)
    const first = createNode().node
    const second = createNode().node
    const firstDirty = vi.spyOn(first, 'dirty')
    const secondDirty = vi.spyOn(second, 'dirty')

    Nova.trackNode(first, () => first.read(source.value))
    Nova.trackNode(second, () => second.read(source.value))

    source.value = 2

    expect(firstDirty).toHaveBeenCalledWith({ update: true, render: true })
    expect(secondDirty).toHaveBeenCalledWith({ update: true, render: true })
  })
})

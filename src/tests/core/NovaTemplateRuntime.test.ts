import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponentNode,
  NovaNode,
  NovaTemplateRuntime,
  reconcileNovaTemplateChildren,
  type NovaApp,
  type NovaComponentDescriptor,
  type NovaComponentSchema,
  type NovaComponentCreateContext,
  type NovaSurface,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

interface TestProps {
  label?: string | number
}

class TemplateTestNode extends NovaComponentNode<TestProps> {
  render(): void {}
}

class TemplateHostNode extends NovaNode<Record<string, any>> {
  readonly template = new NovaTemplateRuntime(this)
  updateCount = 0

  update(): void {
    this.updateCount += 1
    if (this.updateCount > 2) {
      throw new Error('Template runtime scheduled a self-update loop')
    }

    this.template.reconcile([
      { type: 'test.template', id: 'host-child', props: { label: 'Host child' } },
    ])
  }
}

class CompiledTemplateNode extends NovaNode<Record<string, any>> {
  props: Record<string, unknown>
  listeners: Record<string, (...args: Array<any>) => void>
  slots: Record<string, (scope?: Record<string, any>) => Array<any>>

  constructor(
    app: NovaApp<Record<string, any>>,
    surface: NovaSurface<Record<string, any>>,
    props: Record<string, unknown> = {},
    listeners: Record<string, (...args: Array<any>) => void> = {},
    slots: Record<string, (scope?: Record<string, any>) => Array<any>> = {},
  ) {
    super(app, surface)
    this.props = props
    this.listeners = listeners
    this.slots = slots
  }

  setProps(patch: Record<string, unknown>): this {
    this.props = {
      ...this.props,
      ...patch,
    }
    return this
  }

  setListeners(listeners: Record<string, (...args: Array<any>) => void>): this {
    this.listeners = listeners
    return this
  }

  setSlots(slots: Record<string, (scope?: Record<string, any>) => Array<any>> = {}): this {
    this.slots = slots
    return this
  }
}

class ReplacementCompiledTemplateNode extends CompiledTemplateNode {}

class LargeCompiledTemplateNode extends NovaNode<Record<string, any>> {
  readonly template = new NovaTemplateRuntime(this)
  props: Record<string, unknown>

  constructor(
    app: NovaApp<Record<string, any>>,
    surface: NovaSurface<Record<string, any>>,
    props: Record<string, unknown> = {},
  ) {
    super(app, surface)
    this.props = props
  }

  setProps(patch: Record<string, unknown>): this {
    this.props = {
      ...this.props,
      ...patch,
    }
    return this
  }

  update(): void {
    const version = Number(this.props.version ?? 0)
    this.template.reconcile(Array.from({ length: 500 }, (_item, index) => ({
      type: CompiledTemplateNode,
      id: `large-child-${index}`,
      key: `large-child-${index}`,
      props: { label: `${version}:${index}` },
    })))
  }

  override dispose(): void {
    this.template.dispose()
    super.dispose()
  }
}

interface RefTestApi {
  value: number
  increment(delta: number): number
}

class RefApiNode extends NovaNode<Record<string, any>> {
  readonly api: RefTestApi = {
    value: 0,
    increment(delta: number): number {
      this.value += delta
      return this.value
    },
  }

  constructor(
    app: NovaApp<Record<string, any>>,
    surface: NovaSurface<Record<string, any>>,
  ) {
    super(app, surface)
  }

  getApi(): RefTestApi {
    return this.api
  }
}

function createDescriptor(): NovaComponentDescriptor<TestProps, unknown, Record<string, unknown>, TestProps> {
  const descriptor: NovaComponentDescriptor<TestProps, unknown, Record<string, unknown>, TestProps> = {
    type: 'test.template',
    name: 'TemplateTest',
    version: '1.0.0',
    kind: 'node-component',
    normalize: schema => ({ label: schema.props?.label }),
    createNode: (
      ctx: NovaComponentCreateContext<Record<string, any>>,
      schema: NovaComponentSchema<TestProps>,
    ) => new TemplateTestNode(
      ctx.app,
      ctx.surface,
      descriptor,
      descriptor.normalize!(schema),
      { componentId: schema.id },
    ),
  }
  return descriptor
}

describe('Nova template runtime', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('reuses keyed nodes and patches props without recreating identity', () => {
    const app = createTestApp()
    app.schema.register(createDescriptor())
    const surface = app.createSurface('template')
    const parent = surface.createNode()
    const runtime = new NovaTemplateRuntime(parent)

    runtime.reconcile([
      { type: 'test.template', id: 'a', key: 'a', props: { label: 'A' } },
      { type: 'test.template', id: 'b', key: 'b', props: { label: 'B' } },
    ])
    const first = parent.children[0]
    const second = parent.children[1]

    const stats = runtime.reconcile([
      { type: 'test.template', id: 'b', key: 'b', props: { label: 'B2' } },
      { type: 'test.template', id: 'a', key: 'a', props: { label: 'A2' } },
    ])

    expect(stats.created).toBe(0)
    expect(stats.reused).toBe(2)
    expect(parent.children[0]).toBe(second)
    expect(parent.children[1]).toBe(first)
    expect((first as TemplateTestNode).getProps().label).toBe('A2')
    expect((second as TemplateTestNode).getProps().label).toBe('B2')

    app.destroy()
  })

  it('forwards explicit context while reconciling children', () => {
    const app = createTestApp()
    app.schema.register(createDescriptor())
    const surface = app.createSurface('template-context')
    const parent = surface.createNode()

    const result = reconcileNovaTemplateChildren(parent, [], [
      { type: 'test.template', id: 'row', context: { rowId: 'row-1' } },
    ])

    expect(result.nodes[0].getContext<{ rowId: string }>().rowId).toBe('row-1')

    app.destroy()
  })

  it('does not schedule generated template hosts into a sync self-update loop', () => {
    const app = createTestApp()
    app.schema.register(createDescriptor())
    const surface = app.createSurface('template-host')

    const host = surface.createNode(TemplateHostNode)

    expect(host.updateCount).toBe(1)
    expect(host.children).toHaveLength(1)
    expect(host.template.getStats().created).toBe(1)

    app.destroy()
  })

  it('creates compiled constructor children and patches props/listeners', () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template')
    const parent = surface.createNode()
    const runtime = new NovaTemplateRuntime(parent)
    const firstListener = vi.fn()
    const secondListener = vi.fn()

    runtime.reconcile([
      {
        type: CompiledTemplateNode,
        id: 'compiled',
        props: { label: 'first' },
        events: { press: firstListener },
      },
    ])

    const node = parent.children[0] as CompiledTemplateNode
    const stats = runtime.reconcile([
      {
        type: CompiledTemplateNode,
        id: 'compiled',
        props: { label: 'second' },
        events: { press: secondListener },
      },
    ])

    expect(stats.created).toBe(0)
    expect(stats.reused).toBe(1)
    expect(parent.children[0]).toBe(node)
    expect(node.props.label).toBe('second')
    expect(node.listeners.press).toBe(secondListener)

    app.destroy()
  })

  it('creates compiled constructor children and patches slots without recreating identity', () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template-slots')
    const parent = surface.createNode()
    const runtime = new NovaTemplateRuntime(parent)
    const firstSlot = vi.fn(() => [{ type: 'test.template', id: 'slot-a', props: { label: 'A' } }])
    const secondSlot = vi.fn(() => [{ type: 'test.template', id: 'slot-b', props: { label: 'B' } }])

    runtime.reconcile([
      {
        type: CompiledTemplateNode,
        id: 'compiled',
        slots: { thumb: firstSlot },
      },
    ])

    const node = parent.children[0] as CompiledTemplateNode
    const stats = runtime.reconcile([
      {
        type: CompiledTemplateNode,
        id: 'compiled',
        slots: { thumb: secondSlot },
      },
    ])

    expect(stats.created).toBe(0)
    expect(stats.reused).toBe(1)
    expect(parent.children[0]).toBe(node)
    expect(node.slots.thumb({ value: 1 })).toEqual([{ type: 'test.template', id: 'slot-b', props: { label: 'B' } }])

    runtime.reconcile([{ type: CompiledTemplateNode, id: 'compiled' }])

    expect((parent.children[0] as CompiledTemplateNode).slots).toEqual({})

    app.destroy()
  })

  it('mounts compiled templates with props, listeners, slots and scoped refs', () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template-mount')
    const counter = Nova.ref<RefTestApi>('counter')
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const slot = vi.fn(() => [{ type: 'test.template', id: 'slot-mounted', props: { label: 'Mounted' } }])

    const handle = Nova.mount(CompiledTemplateNode, {
      app,
      surface,
      scope: { refs: { counter } },
      props: { label: 'first' },
      listeners: { press: firstListener },
      slots: { thumb: slot },
    })
    const node = handle.node as CompiledTemplateNode

    expect(node.props).toMatchObject({
      label: 'first',
    })
    expect((node.props.novaRefs as Record<string, unknown>).counter).toBe(counter)
    expect(node.listeners.press).toBe(firstListener)
    expect(node.slots.thumb).toBe(slot)

    handle.updateProps({ label: 'second' })
    handle.updateListeners({ press: secondListener })

    expect(node.props).toMatchObject({
      label: 'second',
    })
    expect((node.props.novaRefs as Record<string, unknown>).counter).toBe(counter)
    expect(node.listeners.press).toBe(secondListener)

    handle.destroy()

    expect(node.lifecycleState).toBe('destroyed')

    app.destroy()
  })

  it('preserves keyed identity when reconciling slot factory output', () => {
    const app = createTestApp()
    app.schema.register(createDescriptor())
    const surface = app.createSurface('slot-output')
    const parent = surface.createNode()
    const runtime = new NovaTemplateRuntime(parent)
    const slot = (label: string) => [
      { type: 'test.template', id: 'slot-child', key: 'slot-child', props: { label } },
    ]

    runtime.reconcile(slot('first'))
    const node = parent.children[0]
    const stats = runtime.reconcile(slot('second'))

    expect(stats.created).toBe(0)
    expect(stats.reused).toBe(1)
    expect(parent.children[0]).toBe(node)
    expect((node as TemplateTestNode).getProps().label).toBe('second')

    app.destroy()
  })

  it('keeps repeated slot output reconcile under budget without node churn', () => {
    const app = createTestApp()
    app.schema.register(createDescriptor())
    const surface = app.createSurface('slot-output-perf')
    const parent = surface.createNode()
    const runtime = new NovaTemplateRuntime(parent)
    const slot = (index: number) => [
      { type: CompiledTemplateNode, id: 'slot-track', key: 'slot-track', props: { label: index } },
      { type: CompiledTemplateNode, id: 'slot-thumb', key: 'slot-thumb', props: { label: index } },
    ]
    const snapshots = Array.from({ length: 1_000 }, (_, index) => slot(index + 1))

    runtime.reconcile(slot(0))
    const track = parent.children[0]
    const thumb = parent.children[1]
    let bestElapsed = Number.POSITIVE_INFINITY
    let bestChurn = Number.POSITIVE_INFINITY

    for (let pass = 0; pass < 3; pass += 1) {
      const startedAt = performance.now()
      let churn = 0

      for (const snapshot of snapshots) {
        const stats = runtime.reconcile(snapshot)
        churn += stats.created + stats.removed
      }

      const elapsed = performance.now() - startedAt
      if (elapsed < bestElapsed) {
        bestElapsed = elapsed
        bestChurn = churn
      }
    }

    expect(bestChurn).toBe(0)
    expect(parent.children[0]).toBe(track)
    expect(parent.children[1]).toBe(thumb)
    expect(bestElapsed).toBeLessThan(250)
    console.info(`[bench] nova-runtime:keyed-slot-reconcile elapsed=${bestElapsed.toFixed(2)}ms budget=250ms churn=${bestChurn}`)

    app.destroy()
  })

  it('keeps repeated mountHandle prop updates on a large keyed template under budget', () => {
    const app = createTestApp()
    const surface = app.createSurface('large-compiled-template-perf')
    const handle = Nova.mount(LargeCompiledTemplateNode, {
      app,
      surface,
      props: { version: 0 },
    })
    const node = handle.node as LargeCompiledTemplateNode

    expect(node.children).toHaveLength(500)

    const startedAt = performance.now()
    let churn = 0
    for (let index = 1; index <= 1_000; index += 1) {
      handle.updateProps({ version: index })
    }
    node.update()
    const stats = node.template.getStats()
    churn += stats.created + stats.removed
    const elapsed = performance.now() - startedAt

    expect(churn).toBe(0)
    expect(node.children).toHaveLength(500)
    expect(elapsed).toBeLessThan(250)
    console.info(`[bench] nova-runtime:mount-update-props-500 elapsed=${elapsed.toFixed(2)}ms budget=250ms churn=${churn} childCount=${node.children.length}`)

    app.destroy()
  })

  it('recreates compiled constructor children when constructor changes', () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template-hmr')
    const parent = surface.createNode()
    const runtime = new NovaTemplateRuntime(parent)

    runtime.reconcile([{ type: CompiledTemplateNode, id: 'compiled' }])
    const first = parent.children[0]
    const stats = runtime.reconcile([{ type: ReplacementCompiledTemplateNode, id: 'compiled' }])

    expect(stats.created).toBe(1)
    expect(stats.removed).toBe(1)
    expect(parent.children[0]).not.toBe(first)
    expect(parent.children[0]).toBeInstanceOf(ReplacementCompiledTemplateNode)

    app.destroy()
  })

  it('binds proxy refs, resolves ready promises and preserves method this', async () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template-ref')
    const parent = surface.createNode()
    const ref = Nova.ref<RefTestApi>('counter')
    const ready = ref.$ready()
    const runtime = new NovaTemplateRuntime(parent, {
      refs: { counter: ref },
    })

    expect(ref.$mounted).toBe(false)
    expect(() => ref.increment(1)).toThrow('[NovaRef] Ref "counter" is not mounted.')

    runtime.reconcile([{ type: RefApiNode, id: 'counter', ref: 'counter' }])

    await expect(ready).resolves.toBe((parent.children[0] as RefApiNode).api)
    expect(ref.$mounted).toBe(true)
    expect(ref.increment(2)).toBe(2)
    expect((parent.children[0] as RefApiNode).api.value).toBe(2)

    runtime.reconcile([])

    expect(ref.$mounted).toBe(false)
    expect(() => ref.increment(1)).toThrow('[NovaRef] Ref "counter" is not mounted.')

    app.destroy()
  })

  it('unbinds proxy refs on parent dispose', () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template-ref-dispose')
    const parent = surface.createNode()
    const ref = Nova.ref<RefTestApi>('counter')
    const runtime = new NovaTemplateRuntime(parent, {
      refs: { counter: ref },
    })

    runtime.reconcile([{ type: RefApiNode, id: 'counter', ref: 'counter' }])

    expect(ref.$mounted).toBe(true)

    parent.remove()

    expect(ref.$mounted).toBe(false)

    app.destroy()
  })

  it('binds keyed ref maps and unbinds removed keys', () => {
    const app = createTestApp()
    const surface = app.createSurface('compiled-template-ref-map')
    const parent = surface.createNode()
    const rows = Nova.refMap<RefTestApi>()
    const runtime = new NovaTemplateRuntime(parent, {
      refs: { rows },
    })

    runtime.reconcile([
      { type: RefApiNode, id: 'row-a', key: 'a', ref: 'rows', refKey: 'a' },
      { type: RefApiNode, id: 'row-b', key: 'b', ref: 'rows', refKey: 'b' },
    ])

    expect(rows.get('a').$mounted).toBe(true)
    expect(rows.get('b').increment(3)).toBe(3)

    runtime.reconcile([
      { type: RefApiNode, id: 'row-b', key: 'b', ref: 'rows', refKey: 'b' },
    ])

    expect(rows.get('a').$mounted).toBe(false)
    expect(rows.get('b').$mounted).toBe(true)

    app.destroy()
  })
})

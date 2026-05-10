import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
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
  label?: string
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

  constructor(
    app: NovaApp<Record<string, any>>,
    surface: NovaSurface<Record<string, any>>,
    props: Record<string, unknown> = {},
    listeners: Record<string, (...args: Array<any>) => void> = {},
  ) {
    super(app, surface)
    this.props = props
    this.listeners = listeners
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
}

class ReplacementCompiledTemplateNode extends CompiledTemplateNode {}

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
})

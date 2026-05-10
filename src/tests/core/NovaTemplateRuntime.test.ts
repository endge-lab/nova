import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NovaComponentNode,
  NovaTemplateRuntime,
  reconcileNovaTemplateChildren,
  type NovaComponentDescriptor,
  type NovaComponentSchema,
  type NovaComponentCreateContext,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

interface TestProps {
  label?: string
}

class TemplateTestNode extends NovaComponentNode<TestProps> {
  render(): void {}
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
    const surface = app.createSurface2D('template')
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
    const surface = app.createSurface2D('template-context')
    const parent = surface.createNode()

    const result = reconcileNovaTemplateChildren(parent, [], [
      { type: 'test.template', id: 'row', context: { rowId: 'row-1' } },
    ])

    expect(result.nodes[0].getContext<{ rowId: string }>().rowId).toBe('row-1')

    app.destroy()
  })
})

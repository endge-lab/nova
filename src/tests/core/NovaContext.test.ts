import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponentNode,
  NovaNode,
  type NovaComponentCreateContext,
  type NovaComponentDescriptor,
  type NovaComponentSchema,
  type NovaSurface,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

type TestContext = {
  rowIndex: number
  groupId: string
}

type TestProps = {
  label: string
}

/**
 * Описывает Nova-node TestNode и его runtime-поведение.
 */
class TestNode extends NovaNode<Record<string, any>> {
  updates = 0

  /**
   * Обновляет runtime-состояние TestNode.
   */
  override update(): void {
    this.updates += 1
  }
}

/**
 * Описывает Nova-node TestComponentNode и его runtime-поведение.
 */
class TestComponentNode extends NovaComponentNode<TestProps> {
  /**
   * Выполняет отрисовку TestComponentNode.
   */
  override render(): void {}
}

function createSurface() {
  const app = createTestApp()
  const surface = app.createSurface('context')
  return { app, surface }
}

function createNode(surface: NovaSurface<Record<string, any>>): TestNode {
  const node = new TestNode(surface.nova, surface)
  surface.addChild(node)
  return node
}

describe('Nova context provide/inject', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('creates unique tokens even when descriptions match', () => {
    const first = Nova.createContextToken<{ value: number }>('Duplicate')
    const second = Nova.createContextToken<{ value: number }>('Duplicate')

    expect(first).not.toBe(second)
    expect(first.description).toBe('Duplicate')
  })

  it('injects the nearest ancestor provider', () => {
    const { app, surface } = createSurface()
    const token = Nova.createContextToken<string>('nearest')
    const root = createNode(surface)
    const parent = new TestNode(app, surface)
    const child = new TestNode(app, surface)

    root.provide(token, 'root')
    parent.provide(token, 'parent')
    root.addChild(parent)
    parent.addChild(child)

    expect(child.inject(token)).toBe('parent')

    app.destroy()
  })

  it('returns fallback for optional inject and throws for required inject', () => {
    const { app, surface } = createSurface()
    const token = Nova.createContextToken<string>('missing')
    const node = createNode(surface)

    expect(node.injectOptional(token, 'fallback')).toBe('fallback')
    expect(() => node.inject(token)).toThrow('[NovaNode] Context provider not found')

    app.destroy()
  })

  it('uses cache for repeated inject and invalidates it when provider changes', () => {
    const { app, surface } = createSurface()
    const token = Nova.createContextToken<string>('cached')
    const parent = createNode(surface)
    const child = new TestNode(app, surface)

    parent.provide(token, 'first')
    parent.addChild(child)

    expect(child.inject(token)).toBe('first')
    expect((child as any)._injectCache?.size).toBe(1)
    expect(child.inject(token)).toBe('first')

    parent.provide(token, 'second')

    expect(child.inject(token)).toBe('second')
    expect((child as any)._injectCache?.get(token).value).toBe('second')

    app.destroy()
  })

  it('clears inject cache on reparent and resolves the new scope', () => {
    const { app, surface } = createSurface()
    const token = Nova.createContextToken<string>('reparent')
    const firstParent = createNode(surface)
    const secondParent = new TestNode(app, surface)
    const child = new TestNode(app, surface)

    firstParent.provide(token, 'first')
    secondParent.provide(token, 'second')
    firstParent.addChild(child)

    expect(child.inject(token)).toBe('first')

    surface.addChild(secondParent)
    secondParent.addChild(child)

    expect(child.inject(token)).toBe('second')

    app.destroy()
  })

  it('keeps sibling scopes isolated', () => {
    const { app, surface } = createSurface()
    const token = Nova.createContextToken<string>('sibling')
    const firstParent = createNode(surface)
    const secondParent = new TestNode(app, surface)
    const firstChild = new TestNode(app, surface)
    const secondChild = new TestNode(app, surface)

    firstParent.provide(token, 'first')
    secondParent.provide(token, 'second')
    surface.addChild(secondParent)
    firstParent.addChild(firstChild)
    secondParent.addChild(secondChild)

    expect(firstChild.inject(token)).toBe('first')
    expect(secondChild.inject(token)).toBe('second')

    app.destroy()
  })
})

describe('Nova explicit child context', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('sets and reads node context directly', () => {
    const { app, surface } = createSurface()
    const node = createNode(surface)

    node.setContext<TestContext>({ rowIndex: 2, groupId: 'group-2' })

    expect(node.getContext<TestContext>()).toEqual({ rowIndex: 2, groupId: 'group-2' })
    expect(node.getContextOptional<TestContext>()?.groupId).toBe('group-2')

    app.destroy()
  })

  it('does not inherit context implicitly', () => {
    const { app, surface } = createSurface()
    const parent = createNode(surface)
    const child = new TestNode(app, surface)

    parent.setContext<TestContext>({ rowIndex: 1, groupId: 'parent' })
    parent.addChild(child)

    expect(child.getContextOptional<TestContext>()).toBeUndefined()

    app.destroy()
  })

  it('passes context through addChild options', () => {
    const { app, surface } = createSurface()
    const parent = createNode(surface)
    const child = new TestNode(app, surface)

    parent.addChild(child, {
      context: { rowIndex: 3, groupId: 'child' } satisfies TestContext,
    })

    expect(child.getContext<TestContext>()).toEqual({ rowIndex: 3, groupId: 'child' })

    app.destroy()
  })

  it('passes context through schema registry createChild', () => {
    const { app, surface } = createSurface()
    const parent = createNode(surface)
    const descriptor: NovaComponentDescriptor<TestProps, unknown, Record<string, unknown>, TestProps> = {
      type: 'test.context-node',
      name: 'TestContextNode',
      version: '1.0.0',
      kind: 'node-component',
      normalize: schema => ({ label: schema.props?.label ?? '' }),
      createNode: (
        ctx: NovaComponentCreateContext<Record<string, any>>,
        schema: NovaComponentSchema<TestProps>,
      ) => {
        expect(ctx.parent).toBe(parent)
        expect(ctx.context).toEqual({ rowIndex: 4, groupId: 'schema' })
        return new TestComponentNode(
          ctx.app,
          ctx.surface,
          descriptor,
          descriptor.normalize!(schema),
        )
      },
    }

    app.schema.register(descriptor)

    const child = app.schema.createChild(parent, {
      type: 'test.context-node',
      props: { label: 'A' },
    }, {
      context: { rowIndex: 4, groupId: 'schema' } satisfies TestContext,
    })

    expect(child.getContext<TestContext>()).toEqual({ rowIndex: 4, groupId: 'schema' })

    app.destroy()
  })

  it('keeps old schema createChild signature working', () => {
    const { app, surface } = createSurface()
    const parent = createNode(surface)
    const descriptor: NovaComponentDescriptor<TestProps, unknown, Record<string, unknown>, TestProps> = {
      type: 'test.legacy-node',
      name: 'TestLegacyNode',
      version: '1.0.0',
      kind: 'node-component',
      normalize: schema => ({ label: schema.props?.label ?? '' }),
      createNode: (ctx, schema) => new TestComponentNode(
        ctx.app,
        ctx.surface,
        descriptor,
        descriptor.normalize!(schema),
      ),
    }

    app.schema.register(descriptor)

    const child = app.schema.createChild(parent, {
      type: 'test.legacy-node',
      props: { label: 'legacy' },
    })

    expect(child.getContextOptional()).toBeUndefined()

    app.destroy()
  })
})

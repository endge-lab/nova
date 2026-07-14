import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponent,
  NovaComponentNode,
  NovaNode,
  NovaSchemaRegistry,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaComponentDescriptor,
  type NovaSurface,
} from '@/index'

type TestEvents = Record<string, any>

interface CounterProps {
  text: string
}

interface CounterApi {
  read: () => string
  setText: (text: string) => void
}

/**
 * Описывает Nova-node CounterNode и его runtime-поведение.
 */
class CounterNode<E extends TestEvents> extends NovaComponentNode<CounterProps, CounterApi, Record<string, never>, CounterProps, E> {
  /**
   * Создает экземпляр CounterNode и подготавливает базовое состояние.
   */
  constructor(app: NovaApp<E>, surface: NovaSurface<E>, props: CounterProps, componentId?: string) {
    super(app, surface, COUNTER_DESCRIPTOR, props, { componentId })
  }

  /**
   * Возвращает значение состояния CounterNode.
   */
  override getApi(): CounterApi {
    return {
      read: () => this.props.text,
      setText: text => this.setProps({ text }),
    }
  }
}

const COUNTER_DESCRIPTOR: NovaComponentDescriptor<CounterProps, CounterApi, Record<string, never>, CounterProps> = {
  type: 'test.counter',
  name: 'Counter',
  version: '0.1.0',
  kind: 'node-component',
  createNode: (context, schema) => new CounterNode(
    context.app,
    context.surface,
    {
      text: schema.props?.text ?? '',
    },
    schema.id,
  ),
}

/**
 * Описывает Nova-node InspectorNode и его runtime-поведение.
 */
@NovaComponent({ tag: 'Inspector' })
class InspectorNode extends NovaNode<TestEvents> {
  /**
   * Выполняет отрисовку InspectorNode.
   */
  render(): void {}
}

function create2DContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    createPattern: vi.fn(() => ({})),
  }

  return new Proxy(state, {
    /**
     * Возвращает значение состояния текущего класса.
     */
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = vi.fn()
      }
      return target[prop]
    },
    /**
     * Обновляет значение состояния текущего класса.
     */
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  }) as CanvasRenderingContext2D
}

function installCanvasMocks(): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    value: 2,
    configurable: true,
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === RendererType.Web2D) {
      return create2DContextStub()
    }

    return null
  })
}

function createApp(): NovaApp<TestEvents> {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)

  return Nova.createApp<TestEvents>({
    target: canvas,
    size: { width: 320, height: 180, dpr: 1 },
    renderer: {
      main: RendererType.Web2D,
    },
    scheduler: {
      type: RaphSchedulerType.Sync,
      loop: false,
    },
  })
}

describe('Nova component registry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('creates node components from schema and exposes them by public component id', () => {
    const app = createApp()
    const surface = app.createSurface('components')
    app.schema.register(COUNTER_DESCRIPTOR)

    const node = app.schema.createNode(surface, {
      type: 'test.counter',
      id: 'headline',
      props: {
        text: 'Initial',
      },
    })

    expect(app.components.get('headline')).toBe(node)
    expect(app.components.api<CounterApi>('headline')?.read()).toBe('Initial')

    app.components.api<CounterApi>('headline')?.setText('Updated')

    expect(app.components.requireApi<CounterApi>('headline').read()).toBe('Updated')
    expect(() => app.schema.createNode(surface, { type: 'test.counter', id: 'headline' })).toThrow(/already registered/)

    node.remove()

    expect(app.components.get('headline')).toBeUndefined()
    app.destroy()
  })

  it('creates child components owned by a parent node', () => {
    const app = createApp()
    const surface = app.createSurface('components')
    const parent = surface.createNode()
    app.schema.register(COUNTER_DESCRIPTOR)

    const child = app.schema.createChild(parent, {
      type: 'test.counter',
      id: 'child-counter',
      props: { text: 'Child' },
    })

    expect(parent.children.includes(child)).toBe(true)
    expect(app.components.requireApi<CounterApi>('child-counter').read()).toBe('Child')

    parent.remove()

    expect(app.components.get('child-counter')).toBeUndefined()
    app.destroy()
  })

  it('creates constructor components directly from schema and exposes generic runtime props api', () => {
    const app = createApp()
    const surface = app.createSurface('constructor-components')

    const node = app.schema.createNode(surface, {
      type: InspectorNode,
      id: 'inline-inspector',
      props: { documentId: 'doc-1' },
    }) as InspectorNode & { props: Record<string, any>; setProps: (patch: Record<string, any>) => InspectorNode }

    expect(app.components.get('inline-inspector')).toBe(node)
    expect((app.components.api<any>('inline-inspector') as { props: Record<string, any> }).props.documentId).toBe('doc-1')

    node.setProps({ documentId: 'doc-2' })

    expect((app.components.api<any>('inline-inspector') as { props: Record<string, any> }).props.documentId).toBe('doc-2')
    app.destroy()
  })

  it('registers decorated class components by global tag and resolves them in O(1) maps', () => {
    const app = createApp()
    const surface = app.createSurface('tag-components')

    Nova.registerComponents(app.schema, InspectorNode)

    const node = app.schema.createNode(surface, {
      type: 'Inspector',
      id: 'global-inspector',
      props: { documentId: 'doc-3' },
    })

    expect(node).toBeInstanceOf(InspectorNode)
    expect((app.components.api<any>('global-inspector') as { props: Record<string, any> }).props.documentId).toBe('doc-3')
    expect(app.schema.has('Inspector')).toBe(true)
    app.destroy()
  })

  it('rejects duplicate and reserved global tags', () => {
    const registry = new NovaSchemaRegistry()

    Nova.registerComponents(registry, InspectorNode)

    expect(() => Nova.registerComponents(
      registry,
      /**
       * Описывает ответственность DuplicateInspector в архитектуре проекта.
       */
      class DuplicateInspector extends NovaNode<TestEvents> {
        /**
         * Выполняет отрисовку DuplicateInspector.
         */
        render(): void {}
      },
    )).toThrow(/requires a global tag/)

    registry.reserveTag('ReservedInspector')
    const ReservedInspector = Nova.defineComponent(
      /**
       * Описывает Nova-node ReservedInspectorNode и его runtime-поведение.
       */
      class ReservedInspectorNode extends NovaNode<TestEvents> {
        /**
         * Выполняет отрисовку ReservedInspectorNode.
         */
        render(): void {}
      },
      { tag: 'ReservedInspector' },
    )

    expect(() => Nova.registerComponents(registry, ReservedInspector)).toThrow(/reserved/)
    expect(() => Nova.registerComponents(
      registry,
      Nova.defineComponent(
        /**
         * Описывает Nova-node AnotherInspectorNode и его runtime-поведение.
         */
        class AnotherInspectorNode extends NovaNode<TestEvents> {
          /**
           * Выполняет отрисовку AnotherInspectorNode.
           */
          render(): void {}
        },
        { tag: 'Inspector' },
      ),
    )).toThrow(/already registered/)
  })

  it('expands schema components through descriptor renderSchema', () => {
    const registry = new NovaSchemaRegistry()
    const schema = vi.fn()
    registry.register({
      type: 'test.schema-label',
      name: 'SchemaLabel',
      version: '0.1.0',
      kind: 'schema-component',
      renderSchema: () => [
        {
          type: 'rect',
          x: 1,
          y: 2,
          width: 3,
          height: 4,
        },
      ],
    })

    const handled = registry.renderSchemaComponent(
      { schema } as any,
      { type: 'test.schema-label' },
      'ordered',
    )

    expect(handled).toBe(true)
    expect(schema).toHaveBeenCalledWith([
      {
        type: 'rect',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
    ])
  })
})

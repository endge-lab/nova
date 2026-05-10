import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponentNode,
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

class CounterNode<E extends TestEvents> extends NovaComponentNode<CounterProps, CounterApi, Record<string, never>, CounterProps, E> {
  constructor(app: NovaApp<E>, surface: NovaSurface<E>, props: CounterProps, componentId?: string) {
    super(app, surface, COUNTER_DESCRIPTOR, props, { componentId })
  }

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

function create2DContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    createPattern: vi.fn(() => ({})),
  }

  return new Proxy(state, {
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = vi.fn()
      }
      return target[prop]
    },
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
      defaultSurface: RendererType.Web2D,
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
    const surface = app.createSurface2D('components')
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
    const surface = app.createSurface2D('components')
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

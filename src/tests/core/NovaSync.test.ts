// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponentNode,
  NovaSyncScope,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaComponentDescriptor,
  type NovaSurface,
} from '@/index'

type TestEvents = Record<string, any>

interface BoxProps {
  value: number
  x: number
  readonlyValue?: number
}

/**
 * Описывает Nova-node SyncBoxNode и его runtime-поведение.
 */
class SyncBoxNode<E extends TestEvents> extends NovaComponentNode<BoxProps, unknown, Record<string, never>, BoxProps, E> {
  /**
   * Создает экземпляр SyncBoxNode и подготавливает базовое состояние.
   */
  constructor(app: NovaApp<E>, surface: NovaSurface<E>, props: Partial<BoxProps> = {}, componentId?: string) {
    super(app, surface, SYNC_BOX_DESCRIPTOR, {
      value: props.value ?? 0,
      x: props.x ?? 0,
      readonlyValue: props.readonlyValue,
    }, { componentId })
  }

  /**
   * Возвращает значение состояния SyncBoxNode.
   */
  override getSyncPorts() {
    return {
      ...super.getSyncPorts(),
      readonlyValue: {
        read: () => this.props.readonlyValue ?? 0,
        write: () => undefined,
        writable: false,
      },
    }
  }
}

const SYNC_BOX_DESCRIPTOR: NovaComponentDescriptor<BoxProps, unknown, Record<string, never>, BoxProps> = {
  type: 'test.sync-box',
  name: 'SyncBox',
  version: '0.1.0',
  kind: 'node-component',
  fields: {
    value: { type: 'number' },
    x: { type: 'number' },
    readonlyValue: { type: 'number' },
  },
  createNode: (context, schema) => new SyncBoxNode(context.app, context.surface, schema.props, schema.id),
}

function create2DContextStub(): CanvasRenderingContext2D {
  return new Proxy({} as Record<PropertyKey, any>, {
    /**
     * Возвращает значение состояния текущего класса.
     */
    get(target, prop) {
      if (!(prop in target)) target[prop] = vi.fn()
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
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === RendererType.Web2D) return create2DContextStub()
    return null
  })
}

function createApp(syncScope?: NovaSyncScope): NovaApp<TestEvents> {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const app = Nova.createApp<TestEvents>({
    target: canvas,
    size: { width: 320, height: 180, dpr: 1 },
    renderer: { main: RendererType.Web2D },
    scheduler: { type: RaphSchedulerType.Sync, loop: false },
    ...(syncScope ? { syncScope } : {}),
  })
  app.schema.register(SYNC_BOX_DESCRIPTOR)
  return app
}

function createBox(app: NovaApp<TestEvents>, id: string, props: Partial<BoxProps> = {}): SyncBoxNode<TestEvents> {
  const surface = app.createSurface(`surface-${id}`)
  return app.schema.createNode(surface, {
    type: 'test.sync-box',
    id,
    props,
  }) as SyncBoxNode<TestEvents>
}

describe('NovaSyncScope', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('creates app-local sync scopes by default and accepts shared scopes', () => {
    const localA = createApp()
    const localB = createApp()
    const sharedScope = new NovaSyncScope({ id: 'shared' })
    const sharedA = createApp(sharedScope)
    const sharedB = createApp(sharedScope)

    expect(localA.sync).toBeInstanceOf(NovaSyncScope)
    expect(localA.sync).not.toBe(localB.sync)
    expect(sharedA.sync).toBe(sharedScope)
    expect(sharedB.sync).toBe(sharedScope)

    localA.destroy()
    localB.destroy()
    sharedA.destroy()
    sharedB.destroy()
    sharedScope.dispose()
  })

  it('resolves component prop ports and synchronizes one-way values', () => {
    const app = createApp()
    const source = createBox(app, 'source', { value: 2 })
    const target = createBox(app, 'target', { value: 0 })

    app.sync.link({ from: '#source.value', to: '#target.value' })
    source.setProps({ value: 7 })

    expect(target.getProps().value).toBe(7)
    expect(app.sync.resolvePort('#source.value').read()).toBe(7)
    app.destroy()
  })

  it('supports transform, filter and custom equality', () => {
    const app = createApp()
    const source = createBox(app, 'source', { value: 1 })
    const target = createBox(app, 'target', { value: 0 })

    app.sync.link({
      from: '#source.value',
      to: '#target.value',
      filter: value => Number(value) > 2,
      transform: value => Number(value) * 10,
      equals: (left, right) => Math.abs(Number(left) - Number(right)) < 5,
    })

    source.setProps({ value: 2 })
    expect(target.getProps().value).toBe(0)

    source.setProps({ value: 3 })
    expect(target.getProps().value).toBe(30)

    source.setProps({ value: 3.2 })
    expect(target.getProps().value).toBe(30)
    app.destroy()
  })

  it('supports bidirectional links without ping-pong cycles', () => {
    const app = createApp()
    const left = createBox(app, 'left')
    const right = createBox(app, 'right')

    app.sync.link({ from: '#left.value', to: '#right.value', bidirectional: true })
    left.setProps({ value: 4 })
    expect(right.getProps().value).toBe(4)

    right.setProps({ value: 9 })
    expect(left.getProps().value).toBe(9)
    app.destroy()
  })

  it('coalesces microtask and frame scheduled writes', async () => {
    const frameCallbacks: Array<FrameRequestCallback> = []
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      }),
      configurable: true,
    })

    const app = createApp()
    const source = createBox(app, 'source')
    const micro = createBox(app, 'micro')
    const frame = createBox(app, 'frame')

    app.sync.link({ from: '#source.value', to: '#micro.value', schedule: 'microtask' })
    app.sync.link({ from: '#source.x', to: '#frame.x', schedule: 'frame' })

    source.setProps({ value: 1, x: 10 })
    source.setProps({ value: 2, x: 20 })

    expect(micro.getProps().value).toBe(0)
    expect(frame.getProps().x).toBe(0)

    await Promise.resolve()
    expect(micro.getProps().value).toBe(2)

    frameCallbacks.forEach(callback => callback(performance.now()))
    expect(frame.getProps().x).toBe(20)
    app.destroy()
  })

  it('unregisters disposed node ports and rejects invalid links', () => {
    const app = createApp()
    const source = createBox(app, 'source')
    const target = createBox(app, 'target')

    expect(() => app.sync.link({ from: '#missing.value', to: '#target.value' })).toThrow(/not registered/)
    expect(() => app.sync.link({ id: 'same', from: '#source.value', to: '#target.value' })).not.toThrow()
    expect(() => app.sync.link({ id: 'same', from: '#source.x', to: '#target.x' })).toThrow(/already registered/)
    expect(() => app.sync.link({ from: '#source.value', to: '#target.readonlyValue' })).not.toThrow()
    expect(() => source.setProps({ value: 1 })).toThrow(/readonly/)

    target.remove()
    expect(() => app.sync.resolvePort('#target.value')).toThrow(/not registered/)
    app.destroy()
  })

  it('synchronizes ports across two Nova apps with the same scope', () => {
    const scope = new NovaSyncScope({ id: 'cross-app' })
    const appA = createApp(scope)
    const appB = createApp(scope)
    const source = createBox(appA, 'source')
    const target = createBox(appB, 'target')

    scope.link({ from: '#source.value', to: '#target.value' })
    source.setProps({ value: 42 })

    expect(target.getProps().value).toBe(42)
    appA.destroy()
    appB.destroy()
    scope.dispose()
  })
})

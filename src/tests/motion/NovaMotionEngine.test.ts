import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponentNode,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaComponentDescriptor,
  type NovaSurface,
} from '@/index'

type TestEvents = Record<string, any>

interface CounterProps {
  value: number
  color: string
}

class CounterNode extends NovaComponentNode<CounterProps, unknown, Record<string, never>, CounterProps, TestEvents> {
  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface, COUNTER_DESCRIPTOR, { value: 0, color: '#000000' })
  }
}

const COUNTER_DESCRIPTOR: NovaComponentDescriptor<CounterProps, unknown, Record<string, never>, CounterProps> = {
  type: 'test.motion-counter',
  name: 'MotionCounter',
  version: '0.1.0',
  kind: 'node-component',
  dirtyPolicy: {
    update: ['value'],
    render: ['color'],
  },
}

describe('NovaMotionEngine', () => {
  let app: NovaApp<TestEvents>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    installCanvasMocks()
    installRafMock()
    app = createApp()
  })

  afterEach(() => {
    app.destroy()
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('applies tween number values at deterministic frame times', () => {
    const surface = app.createSurface2D('motion')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.to(node, { x: 100 }, { duration: 100, easing: 'linear' })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expect(node.x).toBe(50)

    app.motion.tick({ now: 100, delta: 50, elapsed: 100, frame: 2 })
    expect(node.x).toBe(100)
  })

  it('overwrites active target/key segments by default', () => {
    const surface = app.createSurface2D('motion')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.to(node, { x: 100 }, { duration: 100, easing: 'linear' })
    app.motion.to(node, { x: 50 }, { duration: 100, easing: 'linear' })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expect(node.x).toBe(25)
  })

  it('cancels target animations and stops patching disposed nodes', () => {
    const surface = app.createSurface2D('motion')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.to(node, { x: 100 }, { duration: 100, easing: 'linear' })
    node.dispose()
    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })

    expect(node.x).toBe(0)
  })

  it('applies component patches through setProps', () => {
    const surface = app.createSurface2D('motion')
    const node = surface.createNode(CounterNode)

    app.motion.to(node, { value: 10, color: '#ffffff' }, { duration: 100, easing: 'linear' })
    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })

    expect(node.getProps().value).toBe(5)
    expect(node.getProps().color).toBe('rgb(128, 128, 128)')
  })
})

function createApp(): NovaApp<TestEvents> {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return Nova.createApp<TestEvents>({
    target: canvas,
    size: { width: 320, height: 180, dpr: 1 },
    renderer: { main: RendererType.Web2D, defaultSurface: RendererType.Web2D },
    scheduler: { type: RaphSchedulerType.AnimationFrame, loop: false },
  })
}

function installCanvasMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type !== RendererType.Web2D) return null
    return new Proxy({ measureText: vi.fn(() => ({ width: 10 })), createPattern: vi.fn(() => ({})) }, {
      get(target, prop) {
        if (!(prop in target)) {
          ;(target as Record<PropertyKey, unknown>)[prop] = vi.fn()
        }
        return (target as Record<PropertyKey, unknown>)[prop]
      },
      set(target, prop, value) {
        ;(target as Record<PropertyKey, unknown>)[prop] = value
        return true
      },
    }) as CanvasRenderingContext2D
  })
}

function installRafMock(): void {
  globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    const id = setTimeout(() => cb(performance.now()), 16)
    return id as unknown as number
  }) as any
  globalThis.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id as unknown as NodeJS.Timeout)) as any
}

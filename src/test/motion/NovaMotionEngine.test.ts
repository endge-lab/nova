import type { NovaApp, NovaComponentDescriptor, NovaSurface } from '@/index'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,

  NovaComponentNode,

  RaphSchedulerType,
  RendererType,
} from '@/index'

type TestEvents = Record<string, any>

interface CounterProps {
  value: number
  color: string
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

/**
 * Описывает Nova-node CounterNode и его runtime-поведение.
 */
class CounterNode extends NovaComponentNode<CounterProps, unknown, Record<string, never>, CounterProps, TestEvents> {
  /**
   * Создает экземпляр CounterNode и подготавливает базовое состояние.
   */
  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface, COUNTER_DESCRIPTOR, { value: 0, color: '#000000' })
  }
}
describe('движок NovaMotion', () => {
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

  it('применяет числовые значения tween в детерминированные моменты кадров', () => {
    const surface = app.createSurface('motion')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.to(node, { x: 100 }, { duration: 100, easing: 'linear' })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expect(node.x).toBe(50)

    app.motion.tick({ now: 100, delta: 50, elapsed: 100, frame: 2 })
    expect(node.x).toBe(100)
  })

  it('по умолчанию перезаписывает активные сегменты target/key', () => {
    const surface = app.createSurface('motion')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.to(node, { x: 100 }, { duration: 100, easing: 'linear' })
    app.motion.to(node, { x: 50 }, { duration: 100, easing: 'linear' })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expect(node.x).toBe(25)
  })

  it('отменяет анимации target и прекращает обновление освобождённых узлов', () => {
    const surface = app.createSurface('motion')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.to(node, { x: 100 }, { duration: 100, easing: 'linear' })
    node.dispose()
    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })

    expect(node.x).toBe(0)
  })

  it('применяет изменения компонента через setProps', () => {
    const surface = app.createSurface('motion')
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
    renderer: { main: RendererType.Web2D },
    scheduler: { type: RaphSchedulerType.AnimationFrame, loop: false },
  })
}

function installCanvasMocks(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type !== RendererType.Web2D) {
      return null
    }
    return new Proxy({ measureText: vi.fn(() => ({ width: 10 })), createPattern: vi.fn(() => ({})) }, {
      /**
       * Возвращает значение состояния текущего класса.
       */
      get(target, prop) {
        if (!(prop in target)) {
          ;(target as Record<PropertyKey, unknown>)[prop] = vi.fn()
        }
        return (target as Record<PropertyKey, unknown>)[prop]
      },
      /**
       * Обновляет значение состояния текущего класса.
       */
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

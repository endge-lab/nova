import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Nova, RaphSchedulerType, RendererType, type NovaApp } from '@/index'

type TestEvents = Record<string, any>

describe('NovaMotion performance', () => {
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

  it('ticks 10k transform-only animated rects under a local budget', () => {
    const surface = app.createSurface2D('perf')
    const nodes = Array.from({ length: 10_000 }, (_, index) => {
      const node = surface.createNode()
      node.options({ x: index % 200, y: Math.floor(index / 200), width: 2, height: 2 })
      return node
    })

    app.motion.timeline({
      autoplay: true,
      stagger: {
        targets: nodes,
        each: 0,
        duration: 100,
        patch: { x: 120 },
      },
      easing: 'linear',
    })

    const start = performance.now()
    app.motion.tick({ now: 50, delta: 16, elapsed: 50, frame: 1 })
    const elapsed = performance.now() - start

    expect(nodes[0].x).toBe(60)
    expect(elapsed).toBeLessThan(1_000)
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Nova, RaphSchedulerType, RendererType, type NovaApp } from '@/index'

type TestEvents = Record<string, any>

describe('NovaMotionTimeline', () => {
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

  it('compiles keyframes and stagger segments deterministically', () => {
    const surface = app.createSurface2D('timeline')
    const first = surface.createNode()
    const second = surface.createNode()
    first.options({ x: 0, y: 0, width: 10, height: 10, opacity: 0 })
    second.options({ x: 0, y: 0, width: 10, height: 10, opacity: 0 })

    app.motion.timeline({
      autoplay: true,
      tracks: [
        { target: first, keyframes: [{ x: 0 }, { at: 100, x: 100 }] },
      ],
      stagger: {
        targets: [first, second],
        each: 50,
        duration: 100,
        patch: { opacity: 1 },
      },
      easing: 'linear',
    })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })

    expect(first.x).toBe(50)
    expect(first.opacity).toBe(0.5)
    expect(second.opacity).toBe(0)

    app.motion.tick({ now: 100, delta: 50, elapsed: 100, frame: 2 })
    expect(second.opacity).toBe(0.5)
  })

  it('supports repeat and yoyo cycles', () => {
    const surface = app.createSurface2D('timeline')
    const node = surface.createNode()
    node.options({ x: 0, y: 0, width: 10, height: 10 })

    app.motion.timeline({
      autoplay: true,
      repeat: 1,
      yoyo: true,
      tracks: [
        { target: node, keyframes: [{ x: 0 }, { at: 100, x: 100 }] },
      ],
      easing: 'linear',
    })

    app.motion.tick({ now: 150, delta: 50, elapsed: 150, frame: 1 })
    expect(node.x).toBe(50)
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

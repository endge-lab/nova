import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOVA_MOTION_PATTERNS,
  NOVA_MOTION_PRESETS,
  Nova,
  NovaNode,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaMotionPatternName,
  type NovaMotionPresetName,
  type NovaSurface,
} from '@/index'

type TestEvents = Record<string, any>

class PerfMotionNode extends NovaNode<TestEvents> {
  fill = '#4f7cff'
  stroke = '#24324a'
  strokeWidth = 1

  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
    this.options({ x: 0, y: 0, width: 2, height: 2, opacity: 1, scaleX: 1, scaleY: 1, rotation: 0 })
  }
}

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

  it.each(Object.keys(NOVA_MOTION_PRESETS) as Array<NovaMotionPresetName>)('ticks preset %s under a local budget', name => {
    const surface = app.createSurface2D(`preset-${name}`)
    const nodes = Array.from({ length: 160 }, (_, index) => {
      const node = surface.createNode(PerfMotionNode)
      node.options({ x: index % 40, y: Math.floor(index / 40), width: 4, height: 4 })
      app.motion.preset(node, name, {
        duration: 120,
        easing: 'linear',
        delay: index % 8,
        distance: 10,
        fill: '#fff2a8',
        stroke: '#4f7cff',
        strokeWidth: 3,
      })
      return node
    })

    const start = performance.now()
    app.motion.tick({ now: 60, delta: 16, elapsed: 60, frame: 1 })
    const elapsed = performance.now() - start

    expect(nodes.length).toBe(160)
    expect(elapsed).toBeLessThan(1_000)
  })

  it.each([100, 500, 1000])('ticks all motion patterns with %s targets under a local budget', count => {
    for (const name of Object.keys(NOVA_MOTION_PATTERNS) as Array<NovaMotionPatternName>) {
      const surface = app.createSurface2D(`pattern-${name}-${count}`)
      const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
      const nodes = Array.from({ length: count }, (_, index) => {
        const node = surface.createNode(PerfMotionNode)
        node.options({ x: index % columns, y: Math.floor(index / columns), width: 2, height: 2 })
        return node
      })
      app.motion.pattern(nodes, name, {
        duration: 120,
        easing: 'linear',
        each: 0,
        columns,
        distance: 8,
      })
    }

    const start = performance.now()
    app.motion.tick({ now: 60, delta: 16, elapsed: 60, frame: 1 })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(1_000)
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

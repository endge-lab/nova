import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

class VisualNode extends NovaNode<TestEvents> {
  private _fill = '#4f7cff'
  private _stroke = '#24324a'
  private _strokeWidth = 1

  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
    this.options({ x: 40, y: 40, width: 30, height: 20, opacity: 1, scaleX: 1, scaleY: 1, rotation: 0 })
  }

  get fill(): string {
    return this._fill
  }

  set fill(value: string) {
    this._fill = value
  }

  get stroke(): string {
    return this._stroke
  }

  set stroke(value: string) {
    this._stroke = value
  }

  get strokeWidth(): number {
    return this._strokeWidth
  }

  set strokeWidth(value: number) {
    this._strokeWidth = value
  }
}

describe('NovaMotion presets and patterns', () => {
  let app: NovaApp<TestEvents>
  let surface: NovaSurface<TestEvents>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    installCanvasMocks()
    installRafMock()
    app = createApp()
    surface = app.createSurface2D('motion-presets')
  })

  afterEach(() => {
    app.destroy()
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps catalog names unique and documented in Russian', () => {
    const presetNames = Object.keys(NOVA_MOTION_PRESETS)
    const patternNames = Object.keys(NOVA_MOTION_PATTERNS)

    expect(new Set(presetNames).size).toBe(presetNames.length)
    expect(new Set(patternNames).size).toBe(patternNames.length)

    for (const meta of [...Object.values(NOVA_MOTION_PRESETS), ...Object.values(NOVA_MOTION_PATTERNS)]) {
      expect(meta.description).toMatch(/[А-Яа-яЁё]/)
      expect(meta.description).not.toContain('—')
      expect(meta.description).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
    }
  })

  it('does not use long dash or emoji in the preset source comments', () => {
    const source = readFileSync(join(process.cwd(), 'src/model/motion/NovaMotionPresets.ts'), 'utf8')
    expect(source).not.toContain('—')
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })

  it.each(Object.keys(NOVA_MOTION_PRESETS) as NovaMotionPresetName[])('runs preset %s through start, middle and final ticks', (name) => {
    const node = surface.createNode(VisualNode)

    const playback = app.motion.preset(node, name, {
      duration: 100,
      easing: 'linear',
      distance: 12,
      fill: '#fff2a8',
      stroke: '#4f7cff',
      strokeWidth: 3,
    })

    app.motion.tick({ now: 0, delta: 0, elapsed: 0, frame: 0 })
    expect(playback.state).toBe('running')

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expectMotionNumbers(node)

    app.motion.tick({ now: 120, delta: 70, elapsed: 120, frame: 2 })
    expectMotionNumbers(node)
    expect(['running', 'finished']).toContain(playback.state)
  })

  it('supports replay by cancelling and resetting the previous preset', () => {
    const node = surface.createNode(VisualNode)
    const first = app.motion.preset(node, 'fadeOut', { duration: 100, easing: 'linear' })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expect(node.opacity).toBe(0.5)

    first.cancel()
    node.options({ x: 40, y: 40, opacity: 1, scaleX: 1, scaleY: 1, rotation: 0 })
    app.motion.preset(node, 'fadeIn', { duration: 100, easing: 'linear' })

    app.motion.tick({ now: 50, delta: 0, elapsed: 50, frame: 2 })
    expect(node.opacity).toBe(0.5)

    app.motion.tick({ now: 120, delta: 70, elapsed: 120, frame: 3 })
    expect(node.opacity).toBe(1)
  })

  it('animates visual preset properties on compatible targets', () => {
    const node = surface.createNode(VisualNode)

    app.motion.preset(node, 'highlight', { duration: 100, easing: 'linear', fill: '#fff2a8' })
    app.motion.preset(node, 'borderPulse', { duration: 100, easing: 'linear', stroke: '#4f7cff', strokeWidth: 3, overwrite: false })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    expect(node.fill).not.toBe('#4f7cff')
    expect(node.stroke).not.toBe('#24324a')
    expect(node.strokeWidth).toBeGreaterThan(1)

    app.motion.tick({ now: 120, delta: 70, elapsed: 120, frame: 2 })
    expect(node.fill).toBe('rgb(79, 124, 255)')
    expect(node.stroke).toBe('rgb(36, 50, 74)')
    expect(node.strokeWidth).toBe(1)
  })

  it.each(Object.keys(NOVA_MOTION_PATTERNS) as NovaMotionPatternName[])('runs pattern %s on a target group', (name) => {
    const targets = Array.from({ length: 16 }, (_, index) => {
      const node = surface.createNode(VisualNode)
      node.options({ x: 20 + (index % 4) * 24, y: 20 + Math.floor(index / 4) * 22 })
      return node
    })

    const playback = app.motion.pattern(targets, name, {
      duration: 100,
      easing: 'linear',
      each: 5,
      columns: 4,
      distance: 10,
    })

    app.motion.tick({ now: 50, delta: 50, elapsed: 50, frame: 1 })
    for (const target of targets) expectMotionNumbers(target)

    app.motion.tick({ now: 220, delta: 170, elapsed: 220, frame: 2 })
    expect(['running', 'finished']).toContain(playback.state)
  })

  it.each(Object.keys(NOVA_MOTION_PATTERNS) as NovaMotionPatternName[])('keeps looping pattern %s alive with repeat infinity', (name) => {
    const targets = Array.from({ length: 16 }, (_, index) => {
      const node = surface.createNode(VisualNode)
      node.options({ x: 20 + (index % 4) * 24, y: 20 + Math.floor(index / 4) * 22 })
      return node
    })

    const playback = app.motion.pattern(targets, name, {
      duration: 100,
      easing: 'linear',
      each: 5,
      columns: 4,
      distance: 10,
      repeat: Infinity,
      yoyo: true,
    })

    app.motion.tick({ now: 1200, delta: 1200, elapsed: 1200, frame: 1 })
    expect(playback.state).toBe('running')
    for (const target of targets) expectMotionNumbers(target)
  })
})

function expectMotionNumbers(node: VisualNode): void {
  expect(Number.isFinite(node.x)).toBe(true)
  expect(Number.isFinite(node.y)).toBe(true)
  expect(Number.isFinite(node.scaleX)).toBe(true)
  expect(Number.isFinite(node.scaleY)).toBe(true)
  expect(Number.isFinite(node.rotation)).toBe(true)
  expect(Number.isFinite(node.opacity)).toBe(true)
}

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

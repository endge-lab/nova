// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaComponentNode,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaComponentDescriptor,
  type NovaNode,
  type NovaSchema,
  type NovaSurface,
} from '@/index'
import type { EventList } from '@endge/utils'

type TestEvents = EventList

interface PerfCursorProps extends Record<string, unknown> {
  active?: boolean
}

let componentCreateCount = 0

class PerfCursorComponent<E extends TestEvents>
  extends NovaComponentNode<PerfCursorProps, Record<string, never>, Record<string, never>, PerfCursorProps, E> {
  constructor(app: NovaApp<E>, surface: NovaSurface<E>, props: PerfCursorProps, componentId?: string) {
    super(app, surface, PERF_CURSOR_DESCRIPTOR, props, { componentId })
    componentCreateCount += 1
    this.options({ width: 18, height: 18, interactive: false })
  }

  override render(): void {
    const schema: NovaSchema = [
      {
        type: 'circle',
        x: 9,
        y: 9,
        radius: this.props.active ? 8 : 6,
        styles: { background: '#111827' },
      },
    ]
    this.renderer.schema(schema)
  }
}

const PERF_CURSOR_DESCRIPTOR: NovaComponentDescriptor<
  PerfCursorProps,
  Record<string, never>,
  Record<string, never>,
  PerfCursorProps
> = {
  type: 'perf.cursor',
  name: 'PerfCursor',
  version: '0.1.0',
  kind: 'node-component',
  dirtyPolicy: { render: ['active'] },
  createNode: (context, schema) => new PerfCursorComponent(
    context.app,
    context.surface,
    schema.props ?? {},
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
      if (!(prop in target)) target[prop] = vi.fn()
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
    value: 1,
    configurable: true,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === RendererType.Web2D) return create2DContextStub()
    return null
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLCanvasElement) {
    const width = this.width || 1200
    const height = this.height || 1200
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function createApp(): NovaApp<TestEvents> {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return Nova.createApp<TestEvents>({
    target: canvas,
    size: { width: 1200, height: 1200, dpr: 1 },
    renderer: {
      main: RendererType.Web2D,
    },
    scheduler: {
      type: RaphSchedulerType.Sync,
      loop: false,
    },
  })
}

function measure(label: string, run: () => void): number {
  const start = performance.now()
  run()
  const elapsed = performance.now() - start
  console.info(`[NovaCursorPerf] ${label}: ${elapsed.toFixed(2)} ms`)
  return elapsed
}

describe('Nova cursor performance', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    componentCreateCount = 0
    installCanvasMocks()
  })

  it('queries 10000 cursor-capable nodes and reuses component cursors inside budget', () => {
    const app = createApp()
    const surface = app.createSurface2D('cursor-perf')
    app.schema.register(PERF_CURSOR_DESCRIPTOR)

    for (let index = 0; index < 10_000; index += 1) {
      app.cursors.register(createPerfCursorNode(index, surface))
    }

    let transitions = 0
    let lastCursor = app.cursors.lastDomCursor
    const elapsedMs = measure('cursor spatial query / 10000 nodes x 1000 queries', () => {
      for (let index = 0; index < 1_000; index += 1) {
        const x = (index % 100) * 10 + 4
        const y = Math.floor(index / 100) * 10 + 4
        app.cursors.syncPointer({ x, y, target: null })
        const currentCursor = app.cursors.lastDomCursor
        if (currentCursor !== lastCursor) {
          transitions += 1
          lastCursor = currentCursor
        }
      }
    })

    const componentSource = createPerfCursorNode(10_001, surface, {
      hover: { type: 'component', component: 'perf.cursor', props: { active: true }, hotspot: { x: 3, y: 3 } },
    })
    app.cursors.register(componentSource)
    app.cursors.syncPointer({ x: 24, y: 24, target: componentSource })
    app.cursors.syncPointer({ x: 25, y: 25, target: componentSource })

    expect(elapsedMs).toBeLessThan(80)
    expect(transitions).toBeLessThanOrEqual(1)
    expect(componentCreateCount).toBe(1)
    expect(app.canvas.element.style.cursor).toBe('none')

    app.destroy()
  })
})

function createPerfCursorNode(
  index: number,
  surface: NovaSurface<TestEvents>,
  cursor: Record<string, unknown> | string = { hover: 'pointer' },
): NovaNode<TestEvents> {
  const x = (index % 100) * 10
  const y = Math.floor(index / 100) * 10
  const bounds = { x, y, width: 8, height: 8 }

  return {
    active: true,
    visible: true,
    surface,
    parent: null,
    children: [],
    weight: 0,
    cursor,
    cursorContext: null,
    containsPoint: (px: number, py: number) => px >= x && px <= x + 8 && py >= y && py <= y + 8,
    getRenderBounds: () => bounds,
  } as unknown as NovaNode<TestEvents>
}

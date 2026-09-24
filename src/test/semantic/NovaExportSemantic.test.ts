// @vitest-environment jsdom

import type { NovaApp, NovaSurface } from '@/index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,

  NovaExportError,
  NovaNode,
  NovaSemanticService,

  RaphSchedulerType,
  RendererType,
} from '@/index'

type TestEvents = Record<string, any>

function createContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
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
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
    if (type === RendererType.Web2D) {
      return createContextStub()
    }
    return null
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: this.width,
      bottom: this.height,
      width: Number.parseFloat(this.style.width) || this.width,
      height: Number.parseFloat(this.style.height) || this.height,
      toJSON: () => ({}),
    } as DOMRect
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((mime?: string) => {
    return `data:${mime ?? 'image/png'};base64,ZmFrZQ==`
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback, mime?: string) => {
    callback(new Blob(['fake'], { type: mime ?? 'image/png' }))
  })
}

function createApp(): NovaApp<TestEvents> {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return Nova.createApp<TestEvents>({
    target: canvas,
    size: { width: 320, height: 180, dpr: 1 },
    renderer: { main: RendererType.Web2D },
    scheduler: { type: RaphSchedulerType.Sync, loop: false },
  })
}

class SemanticNode extends NovaNode<TestEvents> {
  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
    this.options({ width: 120, height: 80 })
  }

  render(): void {
    this.renderSchema([
      {
        type: 'rect',
        x: 4,
        y: 8,
        width: 40,
        height: 24,
        semantic: {
          role: 'button',
          label: 'Schema action',
          focusable: true,
        },
      },
    ])
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  installCanvasMocks()
})

describe('сервис экспорта и семантики движка Nova', () => {
  it('экспортирует png/webp dataUrl и Blob без изменения размера исходного canvas', async () => {
    const app = createApp()
    const before = { width: app.canvas.pixelWidth, height: app.canvas.pixelHeight }

    const png = await app.exportImage({ format: 'png', pixelRatio: 2, rect: { x: 0, y: 0, width: 100, height: 50 } })
    const webp = await app.exportImage({ format: 'webp', preferBlob: true, quality: 0.7 })

    expect(png.dataUrl).toContain('image/png')
    expect(png.width).toBe(200)
    expect(png.height).toBe(100)
    expect(webp.blob?.type).toBe('image/webp')
    expect(webp.byteLength).toBeGreaterThan(0)
    expect(app.canvas.pixelWidth).toBe(before.width)
    expect(app.canvas.pixelHeight).toBe(before.height)
  })

  it('нормализует ошибки экспорта и по запросу включает семантический snapshot', async () => {
    const app = createApp()
    app.semantics.register({ id: 'chart', role: 'chart', label: 'Revenue', scope: 'demo' })

    const exported = await app.exportImage({ includeSemanticSnapshot: true })
    expect(exported.semanticSnapshot?.regions[0]?.label).toBe('Revenue')

    app.canvas.resize(0, 0)
    await expect(app.exportImage()).rejects.toMatchObject({ code: 'empty-canvas' })

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    app.canvas.resize(10, 10)
    await expect(app.exportImage()).rejects.toBeInstanceOf(NovaExportError)
    await expect(app.exportImage()).rejects.toMatchObject({ code: 'tainted-canvas' })
  })

  it('регистрирует, запрашивает, фокусирует и очищает семантические области в стабильном порядке', () => {
    const service = new NovaSemanticService()
    service.register({ id: 'b', role: 'button', label: 'B', scope: 'chart', focusable: true, order: 2 })
    service.register({ id: 'a', role: 'mark', label: 'A', scope: 'chart', focusable: true, order: 1 })
    service.register({ id: 'hidden', role: 'mark', label: 'Hidden', scope: 'chart', state: { hidden: true } })

    expect(service.query({ scope: 'chart' }).map(item => item.id)).toEqual(['a', 'b'])
    expect(service.focusNext({ scope: 'chart' })?.id).toBe('a')
    expect(service.focusNext({ scope: 'chart' })?.id).toBe('b')
    expect(service.snapshot({ scope: 'chart', includeData: false }).focusedId).toBe('b')

    service.clearScope('chart')
    expect(service.snapshot({ scope: 'chart' }).regions).toEqual([])
  })

  it('синхронизирует семантику элементов схемы и удаляет её при освобождении узла', () => {
    const app = createApp()
    const surface = app.createSurface('semantic-node-test')
    const node = new SemanticNode(app, surface)
    surface.addChild(node)
    node.dirty({ render: true })
    app.raph.run()

    const snapshot = app.semantics.snapshot()
    expect(snapshot.regions.some(region => region.label === 'Schema action' && region.role === 'button')).toBe(true)

    node.dispose()
    expect(app.semantics.query({ role: 'button' })).toEqual([])
  })
})

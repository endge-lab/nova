import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  NovaNode,
  RaphSchedulerType,
  RendererType,
  type NovaApp,
  type NovaSurface,
} from '@/index'

type TestEvents = Record<string, any>

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

  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = Number.parseFloat(this.style.width) || this.width || 0
    const height = Number.parseFloat(this.style.height) || this.height || 0

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

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return canvas
}

function createApp(
  options: {
    keyboardScope?: 'focused' | 'active' | 'hovered' | 'global' | 'manual'
    width?: number
    height?: number
    dpr?: number
    debug?: boolean
  } = {},
): NovaApp<TestEvents> {
  return Nova.createApp<TestEvents>({
    target: createCanvas(),
    size: {
      width: options.width ?? 320,
      height: options.height ?? 180,
      dpr: options.dpr,
      maxDpr: 2,
    },
    input: {
      pointer: { enabled: true },
      keyboard: {
        enabled: true,
        scope: options.keyboardScope ?? 'global',
        preventDefault: 'handled',
      },
    },
    renderer: {
      main: RendererType.Web2D,
      defaultSurface: RendererType.Web2D,
    },
    scheduler: {
      type: RaphSchedulerType.Sync,
      loop: false,
    },
    debug: {
      enabled: options.debug ?? false,
    },
  })
}

function createInteractiveNode(app: NovaApp<TestEvents>): NovaNode<TestEvents> {
  const surface = app.createSurface2D('test-surface')
  const node = surface.createNode()
  node.options({
    x: 0,
    y: 0,
    width: app.width,
    height: app.height,
    interactive: true,
  })
  return node
}

describe('NovaApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('creates an app from an external canvas target and keeps that canvas on destroy', () => {
    const canvas = createCanvas()
    const app = Nova.createApp<TestEvents>({
      target: canvas,
      size: { width: 300, height: 160, dpr: 2 },
      scheduler: { type: RaphSchedulerType.Sync, loop: false },
    })

    expect(app.width).toBe(300)
    expect(app.height).toBe(160)
    expect(app.dpr).toBe(2)
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(320)

    app.destroy()

    expect(document.body.contains(canvas)).toBe(true)
    expect(canvas.width).toBe(600)
    expect(canvas.height).toBe(320)
  })

  it('resizes logical and pixel sizes with maxDpr guard', () => {
    const app = createApp({ width: 100, height: 80 })

    app.resize({ width: 200, height: 120, dpr: 3, maxDpr: 1.5 })

    expect(app.width).toBe(200)
    expect(app.height).toBe(120)
    expect(app.dpr).toBe(1.5)
    expect(app.canvas.pixelWidth).toBe(300)
    expect(app.canvas.pixelHeight).toBe(180)

    app.destroy()
  })

  it('handles global keyboard events without canvas focus', () => {
    const app = createApp({ keyboardScope: 'global' })
    const node = createInteractiveNode(app)
    const onKeyDown = vi.fn((event: KeyboardEvent) => {
      event.cancelBubble = true
    })
    node.on('keydown', onKeyDown)

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)

    app.destroy()
  })

  it('does not prevent browser shortcuts when no keyboard handler processes the event', () => {
    const app = createApp({ keyboardScope: 'global' })
    createInteractiveNode(app)

    const event = new KeyboardEvent('keydown', {
      key: 'r',
      metaKey: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)

    app.destroy()
  })

  it('does not prevent browser shortcuts when a keyboard handler ignores the event', () => {
    const app = createApp({ keyboardScope: 'global' })
    const node = createInteractiveNode(app)
    const onKeyDown = vi.fn()
    node.on('keydown', onKeyDown)

    const event = new KeyboardEvent('keydown', {
      key: 'r',
      metaKey: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)

    app.destroy()
  })

  it('keeps active keyboard scope silent until the canvas receives pointer activity', () => {
    const app = createApp({ keyboardScope: 'active' })
    const node = createInteractiveNode(app)
    const onKeyDown = vi.fn()
    node.on('keydown', onKeyDown)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(onKeyDown).not.toHaveBeenCalled()

    app.canvas.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(onKeyDown).toHaveBeenCalledTimes(1)

    app.destroy()
  })

  it('updates node interactive flag and allows zIndex zero', () => {
    const app = createApp()
    const surface: NovaSurface<TestEvents> = app.createSurface2D('test-surface')
    const node = surface.createNode()

    expect(node.interactive).toBe(false)
    node.interactive = true
    expect(node.interactive).toBe(true)

    node.options({ zIndex: 7 })
    expect(node.weight).toBe(7)
    node.options({ zIndex: 0 })
    expect(node.weight).toBe(0)

    app.destroy()
  })

})

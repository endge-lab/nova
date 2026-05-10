import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Nova,
  RaphSchedulerType,
  RendererType,
} from '@/index'
import type {
  NovaNode,
  NovaApp,
  NovaSurface,
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

function createWebGLContextStub(): WebGL2RenderingContext {
  const constants: Record<string, number> = {
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0be2,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    CONTEXT_LOST_WEBGL: 0x9242,
    CULL_FACE: 0x0b44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0b71,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    INVALID_ENUM: 0x0500,
    INVALID_OPERATION: 0x0502,
    INVALID_VALUE: 0x0501,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8b82,
    MAX_TEXTURE_SIZE: 0x0d33,
    NEAREST: 0x2600,
    NO_ERROR: 0,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    OUT_OF_MEMORY: 0x0505,
    RGBA: 0x1908,
    SCISSOR_TEST: 0x0c11,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88e4,
    STENCIL_BUFFER_BIT: 0x0400,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8b31,
  }

  const state: Record<PropertyKey, any> = {
    ...constants,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    bindVertexArray: vi.fn(),
    blendFuncSeparate: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteVertexArray: vi.fn(),
    detachShader: vi.fn(),
    disable: vi.fn(),
    drawArrays: vi.fn(),
    enable: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getError: vi.fn(() => constants.NO_ERROR),
    getExtension: vi.fn(() => null),
    getParameter: vi.fn(() => 4096),
    getProgramInfoLog: vi.fn(() => ''),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => ({})),
    linkProgram: vi.fn(),
    pixelStorei: vi.fn(),
    scissor: vi.fn(),
    shaderSource: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
  }

  return state as WebGL2RenderingContext
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

    if (type === RendererType.WebGL || type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      return createWebGLContextStub()
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
  const surface = app.createSurface('test-surface')
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
    const surface: NovaSurface<TestEvents> = app.createSurface('test-surface')
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

  it('exposes renderer config and node renderPolicy defaults with overrides', () => {
    const app = createApp()
    const surface = app.createSurface('policy-surface')
    const node = surface.createNode()

    expect(node.renderPolicy).toMatchObject({
      group: 'auto',
      cache: 'auto',
      textQuality: 'auto',
      updateMode: 'dynamic',
      layer: 'auto',
    })

    node.configureRenderPolicy({
      group: 'always',
      cache: 'texture',
      textQuality: 'crisp',
    })

    expect(node.renderPolicy).toMatchObject({
      group: 'always',
      cache: 'texture',
      textQuality: 'crisp',
      updateMode: 'dynamic',
    })
    expect(node.renderDirtyFlags.cache).toBe(true)

    const config = app.configureRenderer({
      text: {
        maxAtlasMemoryMB: 64,
      },
    })

    expect(config.text.maxAtlasMemoryMB).toBe(64)
    expect(config.batching.maxBatchSize).toBe(8192)

    app.destroy()
  })

  it('creates a logical surface without exposing a backend renderer', () => {
    const app = createApp()
    const surface = app.createSurface('logical')

    expect(app.mainRendererType).toBe(RendererType.Web2D)
    expect(() => surface.renderer).toThrow(/only during render/)

    app.destroy()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RaphKernel,
} from '@endge/raph'
import {
  Nova,
  NovaNode,
  NovaPhase,
  RaphSchedulerType,
  RendererType,
} from '@/index'
import type {
  NovaApp,
  NovaDiagnosticsOptions,
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
    diagnostics?: NovaDiagnosticsOptions
    kernel?: RaphKernel
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
    diagnostics: options.diagnostics,
    raph: {
      kernel: options.kernel,
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

class ThemeAwareNode extends NovaNode<TestEvents> {
  updates = 0

  constructor(app: NovaApp<TestEvents>, surface: NovaSurface<TestEvents>) {
    super(app, surface)
    app.theme.observe(this, { phase: NovaPhase.Update })
  }

  update(): void {
    this.updates += 1
  }
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

  it('keeps diagnostics collectors disabled by default', () => {
    const raf = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const app = createApp()

    expect(app.diagnostics.enabled).toBe(false)
    expect(raf).not.toHaveBeenCalled()
    expect(app.diagnostics.snapshot().availability.frame).toBe('unavailable')

    app.destroy()
    vi.unstubAllGlobals()
  })

  it('collects diagnostics snapshots when enabled', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const app = createApp({ diagnostics: { enabled: true, browser: false } })
    const surface = app.createSurface('diagnostics')
    surface.createNode().options({ width: 10, height: 10 })
    surface.dirty({ update: true, matrix: true, render: true })
    app.raph.run()

    const snapshot = app.diagnostics.snapshot()

    expect(snapshot.runtime.enabled).toBe(true)
    expect(snapshot.runtime.surfaces).toBe(1)
    expect(snapshot.frame.index).toBeGreaterThan(0)
    expect(snapshot.availability.frame).toBe('exact')
    expect(snapshot.availability.resources).toBe('estimated')

    app.destroy()
    vi.unstubAllGlobals()
  })

  it('reads browser diagnostics with unavailable fallbacks', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: {
        usedJSHeapSize: 10 * 1024 * 1024,
        totalJSHeapSize: 20 * 1024 * 1024,
        jsHeapSizeLimit: 100 * 1024 * 1024,
      },
    })
    Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
      configurable: true,
      value: vi.fn().mockResolvedValue({ bytes: 30 * 1024 * 1024 }),
    })

    const app = createApp({ diagnostics: { enabled: true, browser: true, sampleIntervalMs: 1000 } })
    await Promise.resolve()
    await Promise.resolve()

    const snapshot = app.diagnostics.snapshot()

    expect(snapshot.browser.jsHeapUsedMB).toBe(10)
    expect(snapshot.browser.userAgentMemoryMB).toBe(30)
    expect(snapshot.browser.domNodes).toBeGreaterThan(0)
    expect(snapshot.availability.browserHeap).toBe('observed')
    expect(snapshot.availability.gpuProcessMemory).toBe('unavailable')

    app.destroy()
    vi.unstubAllGlobals()
  })

  it('toggles diagnostics options without recreating the app', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const app = createApp()

    app.options({ diagnostics: { enabled: true, browser: false } })
    expect(app.diagnostics.enabled).toBe(true)
    expect(app.diagnostics.snapshot().availability.frame).toBe('exact')

    app.options({ diagnostics: { enabled: false } })
    expect(app.diagnostics.enabled).toBe(false)
    expect(app.diagnostics.snapshot().availability.frame).toBe('unavailable')

    app.destroy()
    vi.unstubAllGlobals()
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

  it('does not prevent page wheel scroll when the hit node has no wheel handler', () => {
    const app = createApp()
    createInteractiveNode(app)

    const event = new WheelEvent('wheel', {
      clientX: 10,
      clientY: 10,
      deltaY: 40,
      cancelable: true,
      bubbles: true,
    })
    app.canvas.element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)

    app.destroy()
  })

  it('prevents page wheel scroll when Nova handles wheel on the hit node', () => {
    const app = createApp()
    const node = createInteractiveNode(app)
    const onWheel = vi.fn()
    node.on('wheel', onWheel)

    const event = new WheelEvent('wheel', {
      clientX: 10,
      clientY: 10,
      deltaY: 40,
      cancelable: true,
      bubbles: true,
    })
    app.canvas.element.dispatchEvent(event)

    expect(onWheel).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)

    app.destroy()
  })

  it('routes canvas lifecycle events only through nodes that subscribe to them', () => {
    const app = createApp()
    const canvasNode = createInteractiveNode(app)
    const moveNode = createInteractiveNode(app)
    const onCanvasLeave = vi.fn()
    const onMouseMove = vi.fn()

    canvasNode.on('canvasleave', onCanvasLeave)
    moveNode.on('mousemove', onMouseMove)

    expect((app as any)._events.interactiveNodes.size).toBe(2)
    expect((app as any)._events.canvasLifecycleNodes.size).toBe(1)

    app.canvas.element.dispatchEvent(new MouseEvent('mouseleave', {
      clientX: -10,
      clientY: 80,
      bubbles: true,
    }))

    expect(onCanvasLeave).toHaveBeenCalledTimes(1)
    expect(onMouseMove).not.toHaveBeenCalled()

    canvasNode.off('canvasleave')

    expect((app as any)._events.interactiveNodes.size).toBe(1)
    expect((app as any)._events.canvasLifecycleNodes.size).toBe(0)

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

  it('stores active theme in Raph kernel and resolves tokens through Nova theme service', () => {
    const app = createApp()

    app.theme.registerMany([
      {
        id: 'light',
        tokens: {
          '--nova-scene-bg': '#ffffff',
          '--nova-scene-text': '#111111',
        },
      },
      {
        id: 'dark',
        tokens: {
          '--nova-scene-bg': '#080d18',
          '--nova-scene-text': '#f7f8ff',
        },
      },
    ])

    expect(app.raph.kernel.get('nova.theme.active')).toBe('light')
    expect(app.theme.resolve('--nova-scene-bg')).toBe('#ffffff')

    app.theme.use('dark')

    expect(app.raph.kernel.get('nova.theme.active')).toBe('dark')
    expect(app.theme.resolve('--nova-scene-text')).toBe('#f7f8ff')
    expect(app.theme.snapshot()).toMatchObject({
      active: 'dark',
      tokens: {
        '--nova-scene-bg': '#080d18',
      },
    })

    app.destroy()
  })

  it('initializes active theme from create options without an intermediate version bump', () => {
    const app = Nova.createApp<TestEvents>({
      target: createCanvas(),
      size: { width: 300, height: 160, dpr: 1 },
      scheduler: { type: RaphSchedulerType.Sync, loop: false },
      theme: {
        active: 'dark',
        themes: [
          {
            id: 'light',
            tokens: {
              '--nova-scene-bg': '#ffffff',
            },
          },
          {
            id: 'dark',
            tokens: {
              '--nova-scene-bg': '#080d18',
            },
          },
        ],
      },
    })

    expect(app.theme.active()).toBe('dark')
    expect(app.theme.version()).toBe(1)
    expect(app.theme.resolve('--nova-scene-bg')).toBe('#080d18')

    app.destroy()
  })

  it('guards unregistered themes and supports fallbacks for missing tokens', () => {
    const app = createApp()

    app.theme.register({
      id: 'light',
      tokens: {
        '--nova-scene-bg': '#ffffff',
      },
    })

    expect(app.theme.resolve('--nova-missing-token', '#ff00ff')).toBe('#ff00ff')
    expect(app.theme.resolve('nova-missing-token', '#ff00ff')).toBe('#ff00ff')
    expect(() => app.theme.use('missing')).toThrow('[NovaTheme]')

    app.destroy()
  })

  it('bumps theme version when the active theme tokens are re-registered', () => {
    const app = createApp()

    app.theme.register({
      id: 'light',
      tokens: {
        '--nova-scene-bg': '#ffffff',
      },
    })
    const version = app.theme.version()

    app.theme.register({
      id: 'light',
      tokens: {
        '--nova-scene-bg': '#f6f7fb',
      },
    })

    expect(app.theme.active()).toBe('light')
    expect(app.theme.version()).toBe(version + 1)
    expect(app.theme.resolve('--nova-scene-bg')).toBe('#f6f7fb')

    app.destroy()
  })

  it('delivers shared theme changes to subscribed Nova runtime lanes through Raph', () => {
    const kernel = new RaphKernel()
    const first = createApp({ kernel })
    const second = createApp({ kernel })

    const themes = [
      {
        id: 'light',
        tokens: {
          '--nova-scene-bg': '#ffffff',
        },
      },
      {
        id: 'dark',
        tokens: {
          '--nova-scene-bg': '#080d18',
        },
      },
    ]
    first.theme.registerMany(themes)
    second.theme.registerMany(themes)

    const surface = second.createSurface('theme-aware')
    const node = surface.createNode(ThemeAwareNode)

    first.theme.use('dark')

    expect(second.theme.active()).toBe('dark')
    expect(node.updates).toBeGreaterThan(0)

    first.destroy()
    second.destroy()
  })
})

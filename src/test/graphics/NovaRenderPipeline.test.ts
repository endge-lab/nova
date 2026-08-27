import type { NovaApp, NovaCanvas, NovaRendererConfig, NovaSchema, NovaSurface } from '@/index'
import { mat3 } from 'gl-matrix'
import { describe, expect, it, vi } from 'vitest'
import {
  Nova,

  NovaGlyphAtlasManager,
  NovaNode,

  NovaSchemaRegistry,

  NovaTextAtlasManager,
  RaphSchedulerType,
  RendererType,
  resolveNovaRendererConfig,
  resolveNovaTextRasterBucket,
  resolveNovaTextRasterScale,
} from '@/index'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'
import { NovaWebGLBatcher } from '@/model/render/backends/webgl/NovaWebGLBatcher'
import { NovaRenderBuilder } from '@/model/render/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import { NovaRenderCompiler } from '@/model/render/compiler/NovaRenderCompiler'
import { NovaRenderFrameBuilder } from '@/model/render/compiler/NovaRenderFrameBuilder'
import { NovaTemplateRuntime } from '@/model/runtime/template/NovaTemplateRuntime'

function noop(): void {}

function create2DContextStub(): CanvasRenderingContext2D {
  return new Proxy({ measureText: (text: string) => ({ width: text.length * 8 }) }, {
    /**
     * Возвращает значение состояния текущего класса.
     */
    get(target, prop) {
      if (!(prop in target)) {
        (target as Record<PropertyKey, any>)[prop] = noop
      }
      return (target as Record<PropertyKey, any>)[prop]
    },
  }) as CanvasRenderingContext2D
}

function createWebGLContextStub(): WebGL2RenderingContext {
  const constants: Record<string, number> = {
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CONTEXT_LOST_WEBGL: 0x9242,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    DYNAMIC_DRAW: 0x88E8,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8D40,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    FRAGMENT_SHADER: 0x8B30,
    INVALID_ENUM: 0x0500,
    INVALID_OPERATION: 0x0502,
    INVALID_VALUE: 0x0501,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_SIZE: 0x0D33,
    NEAREST: 0x2600,
    NO_ERROR: 0,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    OUT_OF_MEMORY: 0x0505,
    RGBA: 0x1908,
    SCISSOR_TEST: 0x0C11,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88E4,
    STENCIL_BUFFER_BIT: 0x0400,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8B31,
  }

  return {
    ...constants,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    bindTexture: vi.fn(),
    bindVertexArray: vi.fn(),
    blendFuncSeparate: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    checkFramebufferStatus: vi.fn(() => constants.FRAMEBUFFER_COMPLETE),
    createBuffer: vi.fn(() => ({})),
    createFramebuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteVertexArray: vi.fn(),
    detachShader: vi.fn(),
    disable: vi.fn(),
    drawArrays: vi.fn(),
    enable: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    framebufferTexture2D: vi.fn(),
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
  } as unknown as WebGL2RenderingContext
}

function createCanvasStub(gl: WebGL2RenderingContext = createWebGLContextStub()): NovaCanvas {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockImplementation((type: string) => {
    if (type === '2d') {
      return create2DContextStub()
    }
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      return gl
    }
    return null
  })
  return {
    dpr: 1,
    element: canvas,
    height: 100,
    maxDpr: 1,
    pixelHeight: 100,
    pixelWidth: 200,
    width: 200,
    getContext2D: () => create2DContextStub(),
    getContextWebGL: () => gl as unknown as WebGLRenderingContext,
  } as unknown as NovaCanvas
}

function createFrameBuilder(): NovaRenderFrameBuilder {
  return new NovaRenderFrameBuilder('test-surface', {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    dpr: 1,
  })
}

class RetainedRectNode extends NovaNode<Record<string, any>> {
  /**
   * Создает node и применяет geometry из template props.
   */
  constructor(
    app: NovaApp<Record<string, any>>,
    surface: NovaSurface<Record<string, any>>,
    props: { x?: number, y?: number, width?: number, height?: number } = {},
  ) {
    super(app, surface)
    this.options(props)
  }

  /**
   * Рисует одиночный primitive, который WebGL replay берет из frame.items.
   */
  render(): void {
    this.renderer.rect({
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
      styles: { background: '#ffffff' },
    })
  }
}

class TemplateReconcileHostNode extends NovaNode<Record<string, any>> {
  private readonly _runtime = new NovaTemplateRuntime(this)

  /**
   * Создает child прямо во время render, как это делает slot reconcile.
   */
  render(): void {
    this._runtime.reconcile([{
      type: RetainedRectNode,
      id: 'template-retained-child',
      props: { x: 4, y: 5, width: 20, height: 10 },
    }])
  }
}

function findNodeItemTransform(surface: NovaSurface<Record<string, any>>, node: NovaNode<Record<string, any>>): mat3 {
  const item = surface.compileRenderFrame().items.find(candidate => candidate.nodeId === node.renderNodeId)
  expect(item?.transform).toBeTruthy()
  return item!.transform!
}

describe('nova render pipeline contracts', () => {
  it('records schema calls into render frame commands and items', () => {
    const frameBuilder = createFrameBuilder()
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const builder = new NovaRenderBuilder(createCanvasStub(), new NovaSchemaRegistry(), writer)
    const transform = mat3.fromTranslation(mat3.create(), [10, 20])

    builder.save()
    builder.setTransform(transform)
    builder.clip(0, 0, 100, 50)
    builder.schema([
      { type: 'rect', x: 1, y: 2, width: 3, height: 4, styles: { background: '#fff' } },
      { type: 'text', text: 'Nova', x: 0, y: 0, width: 40, height: 14 },
    ])
    builder.clearClip()
    builder.restore()

    const frame = frameBuilder.build()

    expect(frame.layers).toHaveLength(1)
    expect(frame.groups).toHaveLength(1)
    expect(frame.items.map(item => item.kind)).toEqual(['rect', 'text'])
    expect(frame.commands.some(command => command.type === 'clip')).toBe(true)
    expect(frame.commands.filter(command => command.type === 'drawItem')).toHaveLength(2)
  })

  it('merges renderer config defaults without mutating zoom buckets', () => {
    const config = resolveNovaRendererConfig({
      text: {
        maxAtlasMemoryMB: 32,
        zoomBuckets: [1, 2],
      },
    })

    expect(config.batching.maxBatchSize).toBe(8192)
    expect(config.text.maxAtlasMemoryMB).toBe(32)
    expect(config.text.zoomBuckets).toEqual([1, 2])
    expect(config.text.zoomBuckets).not.toBe(resolveNovaRendererConfig().text.zoomBuckets)
    expect(config.text.interaction).toMatchObject({
      mode: 'balanced',
      rasterBudgetMs: 2,
      maxRasterScale: 3,
      freezeBuckets: true,
    })
    expect(config.text.lod).toMatchObject({
      enabled: true,
      maxVisibleRuns: 10000,
    })
    expect(config.text.glyphs).toMatchObject({
      retainedBatches: true,
      shapeCacheEntries: 20000,
      runCacheEntries: 10000,
    })
    expect(config.text.sdf).toMatchObject({
      enabled: true,
      pxRange: 8,
      source: 'runtime-sdf',
    })
  })

  it('normalizes nested text pipeline config without dropping defaults', () => {
    const config = resolveNovaRendererConfig({
      text: {
        interaction: {
          mode: 'performance',
          rasterBudgetMs: 0.5,
        },
        lod: {
          minScreenWidthPx: 12,
        },
        glyphs: {
          shapeCacheEntries: 512,
        },
        sdf: {
          source: 'prebuilt-msdf',
        },
      },
    })

    expect(config.text.interaction).toMatchObject({
      mode: 'performance',
      idleMs: 120,
      rasterBudgetMs: 0.5,
      maxRasterScale: 3,
    })
    expect(config.text.lod).toMatchObject({
      enabled: true,
      minScreenWidthPx: 12,
      minScreenHeightPx: 8,
      maxVisibleRuns: 10000,
    })
    expect(config.text.glyphs).toMatchObject({
      retainedBatches: true,
      shapeCacheEntries: 512,
      runCacheEntries: 10000,
    })
    expect(config.text.sdf).toMatchObject({
      enabled: true,
      pxRange: 8,
      source: 'prebuilt-msdf',
      minPaddingPx: 2,
      edgeSoftness: 1,
    })
  })

  it('selects text atlas zoom buckets and reuses cached text runs', () => {
    const config: NovaRendererConfig = resolveNovaRendererConfig({
      text: {
        zoomBuckets: [1, 1.5, 2],
      },
    })
    const atlas = new NovaTextAtlasManager(config.text)
    const text = { type: 'text' as const, text: 'Label', x: 0, y: 0, width: 80, height: 20 }

    const first = atlas.resolve(text, 1.45)
    const second = atlas.resolve(text, 1.45)

    expect(first.bucket).toBe(1.5)
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(second.entry).toBe(first.entry)
  })

  it('keys glyph atlas entries by glyph, script, color and zoom bucket with LRU budget', () => {
    const config = resolveNovaRendererConfig({
      text: {
        maxGlyphAtlasMemoryMB: 0.009,
        zoomBuckets: [1, 2],
      },
    })
    const atlas = new NovaGlyphAtlasManager(config.text)

    const latin = atlas.resolve({ glyph: 'A', fontKey: '12px Inter', color: '#fff' }, 1.9)
    const latinHit = atlas.resolve({ glyph: 'A', fontKey: '12px Inter', color: '#fff' }, 1.9)
    const cyrillic = atlas.resolve({ glyph: 'Ж', fontKey: '12px Inter', color: '#fff' }, 1.9)
    const digit = atlas.resolve({ glyph: '7', fontKey: '12px Inter', color: '#f00' }, 1.9)

    expect(latin.bucket).toBe(2)
    expect(latin.cacheHit).toBe(false)
    expect(latinHit.cacheHit).toBe(true)
    expect(latinHit.entry).toBe(latin.entry)
    expect(cyrillic.entry.key).not.toBe(latin.entry.key)
    expect(digit.entry.key).toContain('#f00')
    expect(atlas.pages.length).toBeGreaterThan(0)
    expect(atlas.memoryMB).toBeLessThanOrEqual(config.text.maxGlyphAtlasMemoryMB)
  })

  it('resolves text raster policy from renderer config', () => {
    const quality = resolveNovaRendererConfig({
      text: {
        quality: 'quality',
        dynamicBuckets: true,
        zoomBuckets: [0.5, 1, 2, 4],
      },
    }).text
    const performance = resolveNovaRendererConfig({
      text: {
        quality: 'performance',
        dynamicBuckets: false,
        zoomBuckets: [1, 2, 4],
      },
    }).text

    expect(resolveNovaTextRasterBucket(quality, 1.8)).toBe(2)
    expect(resolveNovaTextRasterBucket(quality, 0.2)).toBe(0.5)
    expect(resolveNovaTextRasterBucket(performance, 4)).toBe(1)
    expect(resolveNovaTextRasterScale(quality, 1.8, 2)).toBe(4)
    expect(resolveNovaTextRasterScale({ ...quality, maxRasterScale: 3 }, 1.8, 2)).toBe(3)
  })

  it('builds display-order-preserving batches', () => {
    const frameBuilder = createFrameBuilder()
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const builder = new NovaRenderBuilder(createCanvasStub(), new NovaSchemaRegistry(), writer)

    builder.schema([
      { type: 'rect', x: 0, y: 0, width: 10, height: 10, styles: { background: '#fff' } },
      { type: 'rect', x: 12, y: 0, width: 10, height: 10, styles: { background: '#fff' } },
      { type: 'text', text: 'A', x: 0, y: 0, width: 10, height: 10 },
      { type: 'rect', x: 24, y: 0, width: 10, height: 10, styles: { background: '#fff' } },
    ])

    const batches = new NovaWebGLBatcher().buildDisplayOrderBatches(frameBuilder.build().items)

    expect(batches.map(batch => batch.items.length)).toEqual([2, 1, 1])
  })

  it('renders a compiled frame through the new WebGL renderer facade', () => {
    const gl = createWebGLContextStub()
    const renderer = new NovaRendererWebGL(createCanvasStub(gl), new NovaSchemaRegistry())
    renderer.diagnostics.enabled = true
    const schema: NovaSchema = [
      { type: 'rect', x: 0, y: 0, width: 20, height: 10, styles: { background: '#fff' } },
    ]
    const frameBuilder = createFrameBuilder()
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const builder = new NovaRenderBuilder(createCanvasStub(gl), new NovaSchemaRegistry(), writer)

    builder.save()
    builder.setTransform(mat3.create())
    builder.schema(schema)
    builder.restore()

    const metrics = renderer.renderFrame(frameBuilder.build())

    expect(metrics.commands).toBeGreaterThan(0)
    expect(metrics.items).toBe(1)
    expect(renderer.diagnostics.lastFrame?.items).toHaveLength(1)
    expect(gl.drawArrays).toHaveBeenCalled()
  })

  it('syncs template-created child matrices before retained frame item recording', () => {
    const gl = createWebGLContextStub()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      if (type === RendererType.Web2D) {
        return create2DContextStub()
      }
      if (type === RendererType.WebGL || type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
        return gl
      }
      return null
    })
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const app = Nova.createApp<Record<string, any>>({
      target: canvas,
      size: { width: 200, height: 100, dpr: 1 },
      renderer: { main: RendererType.WebGL },
      scheduler: {
        type: RaphSchedulerType.Sync,
        loop: false,
      },
    })
    const surface = app.createSurface('template-retained-transform')
    const host = surface.createNode(TemplateReconcileHostNode)
    host.options({ x: 70, y: 30, width: 120, height: 80 })

    app.raph.run()
    app.raph.run()
    surface.compileRenderFrame()

    const child = host.children.find(node => node instanceof RetainedRectNode) as RetainedRectNode | undefined
    expect(child).toBeTruthy()
    const childTransform = findNodeItemTransform(surface, child!)

    expect(Math.round(child!.matrix[6])).toBe(74)
    expect(Math.round(child!.matrix[7])).toBe(35)
    expect(Math.round(childTransform[6])).toBe(74)
    expect(Math.round(childTransform[7])).toBe(35)

    app.destroy()
    getContextSpy.mockRestore()
  })

  it('patches retained item transforms for dirty transform subtrees', () => {
    const gl = createWebGLContextStub()
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      if (type === RendererType.Web2D) {
        return create2DContextStub()
      }
      if (type === RendererType.WebGL || type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
        return gl
      }
      return null
    })
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const app = Nova.createApp<Record<string, any>>({
      target: canvas,
      size: { width: 200, height: 100, dpr: 1 },
      renderer: { main: RendererType.WebGL },
      scheduler: {
        type: RaphSchedulerType.Sync,
        loop: false,
      },
    })
    const surface = app.createSurface('retained-transform-subtree')
    const parent = surface.createNode()
    const child = surface.createNode(RetainedRectNode)

    parent.options({ x: 0, y: 0, width: 120, height: 80 })
    child.options({ x: 4, y: 5, width: 20, height: 10 })
    parent.addChild(child)
    app.raph.run()
    app.raph.run()

    const firstFrame = surface.compileRenderFrame()
    const firstTransform = findNodeItemTransform(surface, child)
    expect(Math.round(firstTransform[6])).toBe(4)
    expect(Math.round(firstTransform[7])).toBe(5)

    parent.options({ x: 70, y: 30 })
    parent.dirty({ matrix: true })
    app.raph.run()
    app.raph.run()

    const secondFrame = surface.compileRenderFrame()
    const secondTransform = findNodeItemTransform(surface, child)

    expect(secondFrame).toBe(firstFrame)
    expect(Math.round(child.matrix[6])).toBe(74)
    expect(Math.round(child.matrix[7])).toBe(35)
    expect(Math.round(secondTransform[6])).toBe(74)
    expect(Math.round(secondTransform[7])).toBe(35)

    app.destroy()
    getContextSpy.mockRestore()
  })

  it('keeps compiler construction explicit for surface-level orchestration', () => {
    const compiler = new NovaRenderCompiler({
      schemaRegistry: new NovaSchemaRegistry(),
      rendererConfig: resolveNovaRendererConfig(),
    })

    expect(compiler).toBeInstanceOf(NovaRenderCompiler)
    expect(RendererType.WebGL).toBe('webgl')
  })
})

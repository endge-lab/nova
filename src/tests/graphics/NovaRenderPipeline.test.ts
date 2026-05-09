import { describe, expect, it, vi } from 'vitest'
import { mat3 } from 'gl-matrix'
import {
  NovaRenderBuilder,
  NovaRenderCommandWriter,
  NovaRenderCompiler,
  NovaRenderFrameBuilder,
  NovaRendererWebGL,
  NovaSchemaRegistry,
  NovaTextAtlasManager,
  NovaWebGLBatcher,
  RendererType,
  resolveNovaRendererConfig,
  type NovaCanvas,
  type NovaRendererConfig,
  type NovaSchema,
} from '@/index'

function noop(): void {}

function create2DContextStub(): CanvasRenderingContext2D {
  return new Proxy({ measureText: (text: string) => ({ width: text.length * 8 }) }, {
    get(target, prop) {
      if (!(prop in target)) (target as Record<PropertyKey, any>)[prop] = noop
      return (target as Record<PropertyKey, any>)[prop]
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

  return {
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
  } as unknown as WebGL2RenderingContext
}

function createCanvasStub(gl: WebGL2RenderingContext = createWebGLContextStub()): NovaCanvas {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockImplementation((type: string) => {
    if (type === '2d') return create2DContextStub()
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return gl
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

describe('Nova render pipeline contracts', () => {
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

  it('keeps compiler construction explicit for surface-level orchestration', () => {
    const compiler = new NovaRenderCompiler({
      schemaRegistry: new NovaSchemaRegistry(),
      rendererConfig: resolveNovaRendererConfig(),
    })

    expect(compiler).toBeInstanceOf(NovaRenderCompiler)
    expect(RendererType.WebGL).toBe('webgl')
  })
})

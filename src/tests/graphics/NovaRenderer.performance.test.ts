import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovaRenderer2D } from '@/domain/entities/graphics/NovaRenderer2D'
import { NovaRendererWebGL } from '@/domain/entities/graphics/NovaRendererWebGL'
import { NovaRenderQueueRenderer } from '@/domain/entities/graphics/NovaRenderQueueRenderer'
import type { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import type { NovaRenderer, NovaSchema } from '@/domain/types/renderer-types'

type WebGLStats = {
  bufferData: number
  bufferSubData: number
  drawArrays: number
}

type RendererMeasure = {
  fps: number
  frameMs: number
  elapsedMs: number
}

const STRESS_RECT_COUNT = 1200
const STRESS_FRAMES = 120
const MIN_MOCK_FPS = 60
const MIN_FALLBACK_MOCK_FPS = 30

function noop(): void {}

function create2DContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
    canvas: document.createElement('canvas'),
    fillStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    measureText: (text: string) => ({ width: text.length * 8 }),
  }

  return new Proxy(state, {
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = noop
      }
      return target[prop]
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  }) as CanvasRenderingContext2D
}

function createWebGLContextStub(): WebGLRenderingContext & { __stats: WebGLStats } {
  const stats: WebGLStats = {
    bufferData: 0,
    bufferSubData: 0,
    drawArrays: 0,
  }

  const constants: Record<string, number> = {
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0be2,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    CONTEXT_LOST_WEBGL: 0x9242,
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
    __stats: stats,
    activeTexture: noop,
    attachShader: noop,
    bindBuffer: noop,
    bindTexture: noop,
    blendFuncSeparate: noop,
    bufferData: () => {
      stats.bufferData += 1
    },
    bufferSubData: () => {
      stats.bufferSubData += 1
    },
    clear: noop,
    clearColor: noop,
    compileShader: noop,
    createBuffer: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    deleteBuffer: noop,
    deleteProgram: noop,
    deleteShader: noop,
    deleteTexture: noop,
    detachShader: noop,
    disable: noop,
    drawArrays: () => {
      stats.drawArrays += 1
    },
    enable: noop,
    enableVertexAttribArray: noop,
    getAttribLocation: () => 0,
    getError: () => constants.NO_ERROR,
    getExtension: () => null,
    getParameter: () => 4096,
    getProgramInfoLog: () => '',
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getShaderParameter: () => true,
    getUniformLocation: () => ({}),
    linkProgram: noop,
    pixelStorei: noop,
    scissor: noop,
    shaderSource: noop,
    texImage2D: noop,
    texParameteri: noop,
    uniform1f: noop,
    uniform1i: noop,
    uniform2f: noop,
    uniform4f: noop,
    uniformMatrix3fv: noop,
    useProgram: noop,
    vertexAttribPointer: noop,
  } as unknown as WebGLRenderingContext & { __stats: WebGLStats }
}

function createCanvasStub(
  width: number,
  height: number,
  context: CanvasRenderingContext2D | WebGLRenderingContext,
): NovaCanvas {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height

  return {
    dpr: 1,
    element,
    height,
    maxDpr: 1,
    pixelHeight: height,
    pixelWidth: width,
    width,
    getContext2D: () => context as CanvasRenderingContext2D,
    getContextWebGL: () => context as WebGLRenderingContext,
  } as unknown as NovaCanvas
}

function createRectStressSchema(total = STRESS_RECT_COUNT): NovaSchema {
  const colors = ['#7c3aed', '#f472b6', '#22d3ee', 'rgba(17, 24, 39, 0.32)']

  return Array.from({ length: total }, (_, index) => ({
    type: 'rect' as const,
    x: (index % 80) * 18,
    y: Math.floor(index / 80) * 14,
    width: 14,
    height: 9,
    styles: {
      background: colors[index % colors.length],
    },
  }))
}

function createMixedPrimitiveSchema(total = 120): NovaSchema {
  const schema: NovaSchema = []

  for (let index = 0; index < total; index++) {
    const x = (index % 30) * 42
    const y = Math.floor(index / 30) * 34
    const kind = index % 4

    if (kind === 0) {
      schema.push({ type: 'line', x1: x, y1: y, x2: x + 30, y2: y + 18, styles: { color: '#0f172a', width: 2 } })
    } else if (kind === 1) {
      schema.push({ type: 'circle', x: x + 14, y: y + 14, radius: 10, styles: { background: '#22c55e', border: { color: '#14532d', width: 1 } } })
    } else if (kind === 2) {
      schema.push({ type: 'polygon', points: [{ x, y: y + 20 }, { x: x + 16, y }, { x: x + 32, y: y + 20 }], styles: { background: '#f97316' } })
    } else {
      schema.push({ type: 'text', text: 'Nova', x, y, width: 38, height: 18, styles: { font: { family: 'monospace', size: 11 }, color: '#111827' } })
    }
  }

  return schema
}

function measureRenderer(renderer: NovaRenderer, schema: NovaSchema, frames = STRESS_FRAMES): RendererMeasure {
  for (let i = 0; i < 10; i++) {
    renderer.clear()
    renderer.schemaBatched(schema)
  }

  const startedAt = performance.now()
  for (let frame = 0; frame < frames; frame++) {
    renderer.clear()
    renderer.schemaBatched(schema)
  }
  const elapsedMs = performance.now() - startedAt
  const frameMs = elapsedMs / frames

  return {
    elapsedMs,
    fps: frameMs > 0 ? 1000 / frameMs : Number.POSITIVE_INFINITY,
    frameMs,
  }
}

function expectFastRenderer(name: string, result: RendererMeasure): void {
  console.info(`[NovaRendererPerf] ${name}: ${result.fps.toFixed(0)} fps, ${result.frameMs.toFixed(2)} ms/frame`)
  expect(result.fps).toBeGreaterThan(MIN_MOCK_FPS)
}

describe('Nova renderer performance smoke tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      if (type === '2d') {
        return create2DContextStub()
      }
      return null
    })
  })

  it('keeps Canvas2D dense rect rendering within a 60fps mock budget', () => {
    const renderer = new NovaRenderer2D(createCanvasStub(1600, 900, create2DContextStub()))
    const result = measureRenderer(renderer, createRectStressSchema())

    expectFastRenderer('canvas2d rect stress', result)
  })

  it('keeps WebGL dense rect rendering within a 60fps mock budget with ordered vertex-color batching', () => {
    const gl = createWebGLContextStub()
    const renderer = new NovaRendererWebGL(createCanvasStub(1600, 900, gl))
    const schema = createRectStressSchema()

    gl.__stats.drawArrays = 0
    const result = measureRenderer(renderer, schema)

    expectFastRenderer('webgl rect stress', result)
    expect(gl.__stats.drawArrays / STRESS_FRAMES).toBeLessThanOrEqual(1.2)
  })

  it('keeps WebGL texture fallback primitives within a mock benchmark budget', () => {
    const gl = createWebGLContextStub()
    const renderer = new NovaRendererWebGL(createCanvasStub(1600, 900, gl))
    const schema = createMixedPrimitiveSchema()
    const result = measureRenderer(renderer, schema, 60)

    console.info(`[NovaRendererPerf] webgl mixed fallback stress: ${result.fps.toFixed(0)} fps, ${result.frameMs.toFixed(2)} ms/frame`)
    expect(result.fps).toBeGreaterThan(MIN_FALLBACK_MOCK_FPS)
    expect(gl.__stats.drawArrays / 60).toBeGreaterThan(1)
  })

  it('keeps queue collection and flush overhead within a mock budget', () => {
    const renderer = new NovaRenderer2D(createCanvasStub(1600, 900, create2DContextStub()))
    const queue = new NovaRenderQueueRenderer(renderer)
    const schema = createRectStressSchema(10_000)

    for (let i = 0; i < 5; i++) {
      queue.schemaOrdered(schema)
      queue.flush()
    }

    const startedAt = performance.now()
    for (let frame = 0; frame < 60; frame++) {
      queue.schemaOrdered(schema)
      queue.flush()
    }
    const elapsedMs = performance.now() - startedAt
    const frameMs = elapsedMs / 60

    console.info(`[NovaRendererPerf] queue 10k rect stress: ${frameMs.toFixed(2)} ms/frame`)
    expect(frameMs).toBeLessThan(50)
  })
})

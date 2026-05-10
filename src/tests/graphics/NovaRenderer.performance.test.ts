import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'
import { NovaRenderBuilder } from '@/model/render/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import { NovaRenderFrameBuilder } from '@/model/render/compiler/NovaRenderFrameBuilder'
import { NovaTextAtlasManager } from '@/model/render/resources/NovaTextAtlasManager'
import { resolveNovaRendererConfig } from '@/model/render/policy/NovaRenderPolicy'
import { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaCanvas } from '@/model/infrastructure/canvas/NovaCanvas'
import type { NovaRenderer, NovaSchema } from '@/domain/types/renderer.types'

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
const MIN_CURRENT_COMPILED_FRAME_MOCK_FPS = 10

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

function createWebGLContextStub(): WebGL2RenderingContext & { __stats: WebGLStats } {
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
    __stats: stats,
    activeTexture: noop,
    attachShader: noop,
    bindBuffer: noop,
    bindTexture: noop,
    bindVertexArray: noop,
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
    createVertexArray: () => ({}),
    deleteBuffer: noop,
    deleteProgram: noop,
    deleteShader: noop,
    deleteTexture: noop,
    deleteVertexArray: noop,
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
    viewport: noop,
  } as unknown as WebGL2RenderingContext & { __stats: WebGLStats }
}

function createCanvasStub(
  width: number,
  height: number,
  context: CanvasRenderingContext2D | WebGL2RenderingContext,
): NovaCanvas {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  vi.spyOn(element, 'getContext').mockImplementation((type: string) => {
    if (type === '2d') return context as CanvasRenderingContext2D
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return context as WebGL2RenderingContext
    return null
  })

  return {
    dpr: 1,
    element,
    height,
    maxDpr: 1,
    pixelHeight: height,
    pixelWidth: width,
    width,
    getContext2D: () => context as CanvasRenderingContext2D,
    getContextWebGL: () => context as unknown as WebGLRenderingContext,
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

function measureRenderer(renderer: NovaRenderer, schema: NovaSchema, frames = STRESS_FRAMES): RendererMeasure {
  for (let i = 0; i < 10; i++) {
    renderer.clear()
    renderer.schema(schema)
  }

  const startedAt = performance.now()
  for (let frame = 0; frame < frames; frame++) {
    renderer.clear()
    renderer.schema(schema)
  }
  const elapsedMs = performance.now() - startedAt
  const frameMs = elapsedMs / frames

  return {
    elapsedMs,
    fps: frameMs > 0 ? 1000 / frameMs : Number.POSITIVE_INFINITY,
    frameMs,
  }
}

function compileSchemaFrame(canvas: NovaCanvas, schema: NovaSchema): ReturnType<NovaRenderFrameBuilder['build']> {
  const frameBuilder = new NovaRenderFrameBuilder('perf-surface', {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    dpr: canvas.dpr,
  })
  const writer = new NovaRenderCommandWriter(frameBuilder)
  const builder = new NovaRenderBuilder(canvas, new NovaSchemaRegistry(), writer)

  builder.schema(schema)

  return frameBuilder.build()
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

  it('keeps new WebGL compiled frame replay within a mock benchmark budget', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(1600, 900, gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const schema = createRectStressSchema()
    const frame = compileSchemaFrame(canvas, schema)

    for (let i = 0; i < 10; i++) {
      renderer.renderFrame(frame)
    }

    const startedAt = performance.now()
    for (let frameIndex = 0; frameIndex < STRESS_FRAMES; frameIndex++) {
      renderer.renderFrame(frame)
    }
    const elapsedMs = performance.now() - startedAt
    const frameMs = elapsedMs / STRESS_FRAMES
    const fps = frameMs > 0 ? 1000 / frameMs : Number.POSITIVE_INFINITY

    console.info(`[NovaRendererPerf] webgl new compiled frame rect stress: ${fps.toFixed(0)} fps, ${frameMs.toFixed(2)} ms/frame`)
    expect(fps).toBeGreaterThan(MIN_CURRENT_COMPILED_FRAME_MOCK_FPS)
    expect(renderer.diagnostics.lastFrame?.commands.some(command => command.type === 'drawSchemaBatch')).toBe(true)
  })

  it('keeps TextRunAtlas static and partial-change workloads within a mock budget', () => {
    const atlas = new NovaTextAtlasManager(resolveNovaRendererConfig().text)
    const labels = Array.from({ length: 1000 }, (_, index) => ({
      type: 'text' as const,
      text: `Label ${index}`,
      x: 0,
      y: index * 16,
      width: 100,
      height: 16,
    }))

    const startedAt = performance.now()
    for (const label of labels) {
      atlas.resolve(label, 1)
    }
    for (let index = 0; index < labels.length; index += 20) {
      atlas.resolve({ ...labels[index], text: `${labels[index].text}*` }, 1)
    }
    const elapsedMs = performance.now() - startedAt

    console.info(`[NovaRendererPerf] text atlas 1k labels + 5% changes: ${elapsedMs.toFixed(2)} ms, ${atlas.memoryMB.toFixed(2)} MB`)
    expect(elapsedMs).toBeLessThan(120)
    expect(atlas.memoryMB).toBeLessThan(128)
  })

})

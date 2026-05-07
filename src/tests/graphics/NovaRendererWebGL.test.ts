import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovaRendererWebGL } from '@/domain/entities/graphics/NovaRendererWebGL'
import type { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import { RendererType } from '@/domain/types/renderer-types'

function create2DContextStub(): CanvasRenderingContext2D {
  const state: Record<PropertyKey, any> = {
    fillStyle: '#000000',
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

function createWebGLContextStub(): WebGLRenderingContext {
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

  const state: Record<PropertyKey, any> = {
    ...constants,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
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
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
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
  }

  return state as WebGLRenderingContext
}

function createRenderer(): { renderer: NovaRendererWebGL; gl: WebGLRenderingContext } {
  const gl = createWebGLContextStub()
  const element = document.createElement('canvas')
  const canvas = {
    dpr: 2,
    element,
    height: 180,
    width: 320,
    getContextWebGL: () => gl,
  } as unknown as NovaCanvas

  return {
    renderer: new NovaRendererWebGL(canvas),
    gl,
  }
}

function getLastVertexData(gl: WebGLRenderingContext): Float32Array {
  const calls = vi.mocked(gl.bufferSubData).mock.calls
  const data = calls.at(-1)?.[2]

  expect(data).toBeInstanceOf(Float32Array)
  return data as Float32Array
}

function expectRectColor(
  data: Float32Array,
  rectIndex: number,
  expected: [number, number, number, number],
): void {
  const colorOffset = rectIndex * 36 + 2

  expect(data[colorOffset]).toBeCloseTo(expected[0])
  expect(data[colorOffset + 1]).toBeCloseTo(expected[1])
  expect(data[colorOffset + 2]).toBeCloseTo(expected[2])
  expect(data[colorOffset + 3]).toBeCloseTo(expected[3])
}

describe('NovaRendererWebGL', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      if (type === RendererType.Web2D) {
        return create2DContextStub()
      }
      return null
    })
  })

  it('advertises full WebGL renderer capabilities with texture fallbacks', () => {
    const { renderer } = createRenderer()

    expect(renderer.capabilities).toMatchObject({
      border: true,
      circle: true,
      icon: true,
      line: true,
      measureText: true,
      polygon: true,
      rect: true,
      text: true,
      webgl: true,
    })
  })

  it('renders rect and border schema primitives without texture work', () => {
    const { renderer, gl } = createRenderer()

    expect(() => {
      renderer.schemaOrdered([
        { type: 'rect', x: 0, y: 0, width: 20, height: 10, styles: { background: '#a855f7' } },
        { type: 'border', x: 0, y: 0, width: 20, height: 10, styles: { color: '#fff', width: 1 } },
      ])
    }).not.toThrow()

    expect(gl.drawArrays).toHaveBeenCalled()
    expect(gl.texImage2D).not.toHaveBeenCalled()
  })

  it('keeps rgba color straight-alpha instead of multiplying rgb by alpha', () => {
    const { renderer, gl } = createRenderer()

    renderer.rect({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      styles: { background: 'rgba(10, 20, 30, 0.5)' },
    })

    expectRectColor(getLastVertexData(gl), 0, [10 / 255, 20 / 255, 30 / 255, 0.5])
    expect(gl.uniform4f).not.toHaveBeenCalled()
  })

  it('parses transparent css colors as alpha-zero black', () => {
    const { renderer, gl } = createRenderer()

    renderer.rect({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      styles: { background: 'transparent' },
    })

    expectRectColor(getLastVertexData(gl), 0, [0, 0, 0, 0])
  })

  it('parses css color level 4 rgba slash syntax', () => {
    const { renderer, gl } = createRenderer()

    renderer.rect({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      styles: { background: 'rgb(10 20 30 / 50%)' },
    })

    expectRectColor(getLastVertexData(gl), 0, [10 / 255, 20 / 255, 30 / 255, 0.5])
  })

  it('batches many same-color rects into one draw call', () => {
    const { renderer, gl } = createRenderer()
    const schema = Array.from({ length: 1000 }, (_, i) => ({
      type: 'rect' as const,
      x: i,
      y: i,
      width: 2,
      height: 2,
      styles: { background: '#a855f7' },
    }))

    renderer.schemaBatched(schema)

    expect(gl.drawArrays).toHaveBeenCalledTimes(1)
  })

  it('keeps mixed-color rects in schema order inside one vertex-color batch', () => {
    const { renderer, gl } = createRenderer()

    renderer.schemaBatched([
      { type: 'rect', x: 0, y: 0, width: 10, height: 10, styles: { background: '#ff0000' } },
      { type: 'rect', x: 20, y: 0, width: 10, height: 10, styles: { background: '#00ff00' } },
      { type: 'rect', x: 40, y: 0, width: 10, height: 10, styles: { background: '#0000ff' } },
    ])

    const data = getLastVertexData(gl)

    expect(gl.drawArrays).toHaveBeenCalledTimes(1)
    expect(data[0]).toBe(0)
    expect(data[36]).toBe(20)
    expect(data[72]).toBe(40)
    expectRectColor(data, 0, [1, 0, 0, 1])
    expectRectColor(data, 1, [0, 1, 0, 1])
    expectRectColor(data, 2, [0, 0, 1, 1])
  })

  it('renders non-rect primitives through texture fallback methods', () => {
    const { renderer, gl } = createRenderer()
    const icon = document.createElement('canvas')
    icon.width = 8
    icon.height = 8

    expect(() => renderer.line({ x1: 0, y1: 0, x2: 30, y2: 10, styles: { color: '#0f172a', width: 2 } })).not.toThrow()
    expect(() => renderer.circle({ x: 20, y: 20, radius: 8, styles: { background: '#22c55e' } })).not.toThrow()
    expect(() => renderer.icon({ icon, x: 0, y: 0, width: 8, height: 8 })).not.toThrow()
    expect(() => renderer.text({ text: 'Nova', x: 0, y: 0, width: 80, height: 20 })).not.toThrow()
    expect(() => renderer.polygon({ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 10 }], styles: { background: '#f97316' } })).not.toThrow()

    expect(renderer.measureText({ text: 'Nova', x: 0, y: 0, width: 10, height: 10 }).width).toBe(32)
    expect(gl.texImage2D).toHaveBeenCalled()
    expect(gl.drawArrays).toHaveBeenCalled()
  })

  it('caches text textures by content and style', () => {
    const { renderer, gl } = createRenderer()
    const params = {
      text: 'Cached',
      x: 0,
      y: 0,
      width: 120,
      height: 24,
      styles: { font: { family: 'monospace', size: 12 as const }, color: '#111827' },
    }

    renderer.text(params)
    renderer.text(params)

    expect(gl.texImage2D).toHaveBeenCalledTimes(1)
  })

  it('applies nested scissor clips as an intersection stack', () => {
    const { renderer, gl } = createRenderer()

    renderer.clip(10, 20, 100, 80)
    renderer.clip(50, 40, 100, 100)

    expect(gl.scissor).toHaveBeenNthCalledWith(1, 20, 160, 200, 160)
    expect(gl.scissor).toHaveBeenNthCalledWith(2, 100, 160, 120, 120)
    expect(gl.disable).not.toHaveBeenCalledWith(gl.SCISSOR_TEST)

    renderer.clearClip()
    expect(gl.scissor).toHaveBeenNthCalledWith(3, 20, 160, 200, 160)

    renderer.clearClip()

    expect(gl.disable).toHaveBeenCalledWith(gl.SCISSOR_TEST)
  })

  it('restores outer clip after drawing a clipped schema item', () => {
    const { renderer, gl } = createRenderer()

    renderer.clip(0, 0, 100, 100)
    renderer.schemaOrdered([
      { type: 'rect', x: 0, y: 0, width: 20, height: 20, clip: { x: 10, y: 10, width: 20, height: 20 }, styles: { background: '#111827' } },
    ])

    expect(gl.scissor).toHaveBeenNthCalledWith(1, 0, 160, 200, 200)
    expect(gl.scissor).toHaveBeenNthCalledWith(2, 20, 300, 40, 40)
    expect(gl.scissor).toHaveBeenNthCalledWith(3, 0, 160, 200, 200)
  })
})

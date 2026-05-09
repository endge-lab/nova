import { describe, expect, it, vi } from 'vitest'
import {
  NovaRenderBuilder,
  NovaRenderCommandWriter,
  NovaRenderFrameBuilder,
  NovaRendererWebGL,
  NovaSchemaRegistry,
  type NovaCanvas,
  type NovaSchema,
} from '@/index'

type RetainedContractCase = {
  id: string
  priority: 'P0' | 'P1' | 'P2'
  area: 'dirty' | 'compiler' | 'streams' | 'gpu' | 'resources' | 'input'
  assertion: string
}

const RETAINED_CONTRACT_CASES: RetainedContractCase[] = [
  {
    id: 'transform-dirty-skips-node-render',
    priority: 'P0',
    area: 'dirty',
    assertion: 'TransformDirty updates matrix/group uniform without calling node.render().',
  },
  {
    id: 'paint-dirty-updates-handles',
    priority: 'P0',
    area: 'dirty',
    assertion: 'PaintDirty updates only render handles and dirty stream ranges owned by the node.',
  },
  {
    id: 'children-dirty-rebuilds-nearest-group',
    priority: 'P0',
    area: 'dirty',
    assertion: 'ChildrenDirty rebuilds nearest NovaRenderGroup instruction set, not the whole surface.',
  },
  {
    id: 'resource-dirty-updates-atlas-entry',
    priority: 'P0',
    area: 'resources',
    assertion: 'ResourceDirty updates text/texture atlas entries and affected texture quads only.',
  },
  {
    id: 'clean-group-reuses-instruction-set',
    priority: 'P0',
    area: 'compiler',
    assertion: 'Clean NovaRenderGroup reuses NovaInstructionSet and batch plan across frames.',
  },
  {
    id: 'node-id-to-render-handles',
    priority: 'P0',
    area: 'compiler',
    assertion: 'Compiler stores stable nodeId -> NovaRenderHandle[] mapping for direct updates.',
  },
  {
    id: 'plain-rect-fast-stream',
    priority: 'P0',
    area: 'streams',
    assertion: 'Rect without radius/border uses a plain rect stream and does not enter rounded SDF shader.',
  },
  {
    id: 'rounded-rect-instanced-stream',
    priority: 'P0',
    area: 'streams',
    assertion: 'Rounded rect and border use an instanced rounded-rect stream.',
  },
  {
    id: 'gpu-persistent-buffer-capacity',
    priority: 'P0',
    area: 'gpu',
    assertion: 'GPU buffers keep capacity across frames and avoid reallocating for stable counts.',
  },
  {
    id: 'gpu-subdata-dirty-ranges',
    priority: 'P0',
    area: 'gpu',
    assertion: 'Small dirty ranges use bufferSubData instead of full bufferData upload.',
  },
  {
    id: 'gpu-full-upload-threshold',
    priority: 'P1',
    area: 'gpu',
    assertion: 'Full orphan/upload is used only when dirty byte ratio exceeds configured threshold.',
  },
  {
    id: 'painter-order-preserved',
    priority: 'P0',
    area: 'streams',
    assertion: 'Batch planner preserves strict painter order by default.',
  },
  {
    id: 'text-run-atlas-visible-only',
    priority: 'P1',
    area: 'resources',
    assertion: 'TextRunAtlas rasterizes visible dirty text runs only.',
  },
  {
    id: 'texture-atlas-lru',
    priority: 'P1',
    area: 'resources',
    assertion: 'Texture/icon atlas evicts least-recently-used entries under memory pressure.',
  },
  {
    id: 'local-space-hit-index-moving-group',
    priority: 'P1',
    area: 'input',
    assertion: 'Moving group hit-test uses local-space index without rebuilding all item bounds.',
  },
]

function ids(cases: RetainedContractCase[]): string[] {
  return cases.map(testCase => testCase.id)
}

function noop(): void {}

function createWebGLContextStub(): WebGL2RenderingContext {
  const constants: Record<string, number> = {
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0be2,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    CULL_FACE: 0x0b44,
    DEPTH_TEST: 0x0b71,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8b82,
    NO_ERROR: 0,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    SCISSOR_TEST: 0x0c11,
    SRC_ALPHA: 0x0302,
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
    activeTexture: noop,
    attachShader: noop,
    bindBuffer: noop,
    bindTexture: noop,
    bindVertexArray: noop,
    blendFuncSeparate: noop,
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
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
    drawArrays: vi.fn(),
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
    uniformMatrix3fv: vi.fn(),
    useProgram: noop,
    vertexAttribPointer: noop,
    viewport: noop,
  } as unknown as WebGL2RenderingContext
}

function createCanvasStub(gl: WebGL2RenderingContext): NovaCanvas {
  const canvas = document.createElement('canvas')
  vi.spyOn(canvas, 'getContext').mockImplementation((type: string) => {
    if (type === 'webgl2') return gl
    return null
  })

  return {
    dpr: 1,
    element: canvas,
    height: 600,
    maxDpr: 1,
    pixelHeight: 600,
    pixelWidth: 800,
    width: 800,
  } as unknown as NovaCanvas
}

function createRectSchema(count: number): NovaSchema {
  return Array.from({ length: count }, (_, index) => ({
    type: 'rect' as const,
    x: (index % 100) * 8,
    y: Math.floor(index / 100) * 8,
    width: 6,
    height: 6,
    styles: {
      background: index % 2 === 0 ? '#334155' : '#64748b',
    },
  }))
}

function createCompiledFrame(canvas: NovaCanvas, schema: NovaSchema) {
  const frameBuilder = new NovaRenderFrameBuilder('retained-test', {
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

describe('Nova retained WebGL2 renderer target contract matrix', () => {
  it('keeps retained-renderer contract case ids unique', () => {
    expect(new Set(ids(RETAINED_CONTRACT_CASES)).size).toBe(RETAINED_CONTRACT_CASES.length)
  })

  it('covers all P0 target areas required before Pixi parity work', () => {
    const p0Areas = new Set(RETAINED_CONTRACT_CASES.filter(testCase => testCase.priority === 'P0').map(testCase => testCase.area))

    expect(p0Areas).toEqual(new Set(['dirty', 'compiler', 'streams', 'gpu', 'resources']))
  })

  it('keeps every retained contract case measurable', () => {
    for (const testCase of RETAINED_CONTRACT_CASES) {
      expect(testCase.assertion.length).toBeGreaterThan(20)
      expect(testCase.assertion).toMatch(/\.$/)
    }
  })

  it('uses one ordered schema batch for large target WebGL schema arrays', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const frame = createCompiledFrame(canvas, createRectSchema(100))

    expect(frame.commands.filter(command => command.type === 'drawSchemaBatch')).toHaveLength(1)
    expect(frame.items).toHaveLength(0)
  })

  it('replays unchanged cached rect streams without a second GPU upload', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const frame = createCompiledFrame(canvas, createRectSchema(100))

    const first = renderer.renderFrame(frame)
    const second = renderer.renderFrame(frame)

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(second.uploadBytes).toBe(0)
    expect(second.fullUploads).toBe(0)
    expect(second.bufferDataCalls).toBe(0)
    expect(second.bufferSubDataCalls).toBe(0)
    expect(gl.drawArrays).toHaveBeenCalledTimes(2)
  })

  for (const testCase of RETAINED_CONTRACT_CASES) {
    it.todo(`${testCase.priority} ${testCase.id}: ${testCase.assertion}`)
  }
})

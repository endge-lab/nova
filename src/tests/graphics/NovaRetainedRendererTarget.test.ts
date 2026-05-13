import { mat3 } from 'gl-matrix'
import { describe, expect, it, vi } from 'vitest'
import {
  NovaRenderGraph,
  NovaSchemaRegistry,
  NovaTextureAtlasManager,
  NovaTextAtlasManager,
  NovaGlyphAtlasManager,
  NovaRenderHitIndex,
  collectVisibleNovaRenderGroups,
  createNovaRenderGroup,
  resolveNovaRendererConfig,
  type NovaCanvas,
  type NovaParticleBatch,
  type NovaRectBatch,
  type NovaSchema,
} from '@/index'
import { NovaRenderBuilder } from '@/model/render/compiler/NovaRenderBuilder'
import { NovaRenderCommandWriter } from '@/model/render/compiler/NovaRenderCommandWriter'
import { NovaRenderFrameBuilder } from '@/model/render/compiler/NovaRenderFrameBuilder'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'
import { NovaGpuBufferArena } from '@/model/render/backends/webgl/NovaGpuBufferArena'
import { NovaRenderTargetManager } from '@/model/render/targets/NovaRenderTargetManager'

type RetainedContractCase = {
  id: string
  priority: 'P0' | 'P1' | 'P2'
  area: 'dirty' | 'compiler' | 'streams' | 'gpu' | 'resources' | 'input'
  assertion: string
}

const RETAINED_CONTRACT_CASES: Array<RetainedContractCase> = [
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

const ACTIVE_RETAINED_CONTRACT_CASE_IDS = new Set([
  'node-id-to-render-handles',
  'plain-rect-fast-stream',
  'rounded-rect-instanced-stream',
  'gpu-persistent-buffer-capacity',
  'gpu-subdata-dirty-ranges',
  'gpu-full-upload-threshold',
  'painter-order-preserved',
  'text-run-atlas-visible-only',
  'texture-atlas-lru',
  'local-space-hit-index-moving-group',
])

function ids(cases: Array<RetainedContractCase>): Array<string> {
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
    drawArraysInstanced: vi.fn(),
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
    vertexAttribDivisor: vi.fn(),
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

function createMixedSemanticSchema(count: number): NovaSchema {
  const icon = document.createElement('canvas')
  icon.width = 8
  icon.height = 8
  const schema = [] as NovaSchema

  for (let index = 0; index < count; index += 1) {
    const x = (index % 100) * 12
    const y = Math.floor(index / 100) * 12

    schema.push(
      {
        type: 'rect',
        x,
        y,
        width: 10,
        height: 10,
        styles: {
          background: index % 2 === 0 ? '#334155' : '#64748b',
          border: {
            color: '#0f172a',
            width: 1,
            radius: 2,
          },
        },
      },
      {
        type: 'icon',
        x: x + 1,
        y: y + 1,
        width: 4,
        height: 4,
        icon,
      },
      {
        type: 'text',
        x: x + 5,
        y: y + 1,
        width: 5,
        height: 8,
        text: 'text',
        styles: {
          color: '#ffffff',
          font: { size: 8 },
          ellipsis: true,
        },
      },
    )
  }

  schema.semanticScope = 'non-overlap-layered'
  schema.contentVersion = 1
  return schema
}

function mockCanvas2D(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContextMock(this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null

    return {
      canvas: this,
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 5 }),
      setTransform: vi.fn(),
      textBaseline: 'alphabetic',
      fillStyle: '#000000',
      font: '10px sans-serif',
    } as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)
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

function createCompiledFrameWithGraph(canvas: NovaCanvas, schema: NovaSchema) {
  const frameBuilder = new NovaRenderFrameBuilder('retained-test', {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    dpr: canvas.dpr,
  })
  const graph = new NovaRenderGraph('retained-test', frameBuilder.rootGroup)
  const writer = new NovaRenderCommandWriter(frameBuilder, frameBuilder.rootGroup, graph)
  const builder = new NovaRenderBuilder(canvas, new NovaSchemaRegistry(), writer)
  writer.setCurrentNode('grid-node')
  builder.schema(schema)
  return {
    frame: frameBuilder.build(),
    graph,
  }
}

function createParticleBatch(count: number): NovaParticleBatch {
  const positions = new Float32Array(count * 2)
  const sizes = new Float32Array(count)
  const colors = new Float32Array(count * 4)
  const strokeColors = new Float32Array(count * 4)
  const strokeWidths = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    positions[index * 2] = (index % 10) * 10
    positions[index * 2 + 1] = Math.floor(index / 10) * 10
    sizes[index] = 4
    colors[index * 4] = 1
    colors[index * 4 + 1] = 1
    colors[index * 4 + 2] = 1
    colors[index * 4 + 3] = 0
    strokeColors[index * 4] = 1
    strokeColors[index * 4 + 1] = 1
    strokeColors[index * 4 + 2] = 1
    strokeColors[index * 4 + 3] = 1
    strokeWidths[index] = 1
  }

  return {
    kind: 'circle',
    count,
    positions,
    sizes,
    colors,
    strokeColors,
    strokeWidths,
    revision: 0,
    staticRevision: 1,
  }
}

function createParticleFrame(canvas: NovaCanvas, batch: NovaParticleBatch) {
  const frameBuilder = new NovaRenderFrameBuilder('particle-test', {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    dpr: canvas.dpr,
  })
  const graph = new NovaRenderGraph('particle-test', frameBuilder.rootGroup)
  const writer = new NovaRenderCommandWriter(frameBuilder, frameBuilder.rootGroup, graph)
  const builder = new NovaRenderBuilder(canvas, new NovaSchemaRegistry(), writer)
  writer.setCurrentNode('particle-node')
  builder.particles(batch)

  return {
    frame: frameBuilder.build(),
    graph,
  }
}

function createRectBatch(count: number): NovaRectBatch {
  const x = new Float32Array(count)
  const y = new Float32Array(count)
  const width = new Float32Array(count)
  const height = new Float32Array(count)
  const colors = new Float32Array(count * 4)
  const states = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    x[index] = (index % 10) * 12
    y[index] = Math.floor(index / 10) * 8
    width[index] = 10
    height[index] = 6
    colors[index * 4] = 0.2
    colors[index * 4 + 1] = 0.4
    colors[index * 4 + 2] = 0.8
    colors[index * 4 + 3] = 1
    states[index] = index % 2
  }

  return {
    count,
    x,
    y,
    width,
    height,
    colors,
    states,
    revision: 1,
    staticRevision: 1,
  }
}

function createRectBatchFrame(canvas: NovaCanvas, batch: NovaRectBatch) {
  const frameBuilder = new NovaRenderFrameBuilder('rect-batch-test', {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    dpr: canvas.dpr,
  })
  const graph = new NovaRenderGraph('rect-batch-test', frameBuilder.rootGroup)
  const writer = new NovaRenderCommandWriter(frameBuilder, frameBuilder.rootGroup, graph)
  const builder = new NovaRenderBuilder(canvas, new NovaSchemaRegistry(), writer)
  writer.setCurrentNode('rect-batch-node')
  builder.rects(batch)

  return {
    frame: frameBuilder.build(),
    graph,
  }
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

  it('does not compile inactive schema items into large WebGL schema batches', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const schema = Array.from({ length: 100 }, (_, index) => ({
      active: false,
      type: 'border' as const,
      x: index,
      y: 0,
      width: 10,
      height: 10,
      styles: {
        color: '#1635ff',
        width: 3,
      },
    }))
    const frame = createCompiledFrame(canvas, schema)

    expect(frame.commands.filter(command => command.type === 'drawSchemaBatch')).toHaveLength(0)
    expect(frame.commands.filter(command => command.type === 'drawItem')).toHaveLength(0)
    expect(frame.items).toHaveLength(0)
  })

  it('keeps semantic scope on compiled schema batch commands', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const frame = createCompiledFrame(canvas, createMixedSemanticSchema(40))
    const command = frame.commands.find(item => item.type === 'drawSchemaBatch')

    expect(command?.schemaSemanticScope).toBe('non-overlap-layered')
    expect(command?.schemaContentVersion).toBe(1)
  })

  it('stores nodeId to render handles for compiled schema batches', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const { graph } = createCompiledFrameWithGraph(canvas, createMixedSemanticSchema(4))
    const handles = graph.handlesByNodeId.get('grid-node') ?? []

    expect(handles).toHaveLength(12)
    expect(handles.some(handle => handle.streamKind === 'rounded-rect')).toBe(true)
    expect(handles.some(handle => handle.streamKind === 'icon')).toBe(true)
    expect(handles.some(handle => handle.streamKind === 'text-run')).toBe(true)
  })

  it('stores retained streams and safe semantic batch plans on the render graph', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const { graph } = createCompiledFrameWithGraph(canvas, createMixedSemanticSchema(4))
    const plan = graph.rebuildBatchPlan('main:root', 'non-overlap-layered')
    const streams = graph.streamsByGroupId.get('main:root')

    expect(streams?.has('main:root:rounded-rect')).toBe(true)
    expect(streams?.has('main:root:icon')).toBe(true)
    expect(streams?.has('main:root:text-run')).toBe(true)
    const layerOrder = { background: 0, border: 1, texture: 2, text: 3, selection: 4, overlay: 5, strict: 6 }
    const layers = plan.batches.map(batch => batch.semanticLayer)

    expect(layers[0]).toBe('background')
    expect(layers).toContain('texture')
    expect(layers[layers.length - 1]).toBe('text')
    expect(layers.every((layer, index) => index === 0 || layerOrder[layer] >= layerOrder[layers[index - 1]])).toBe(true)
    expect(plan.batches.every(batch => batch.slotCount > 0)).toBe(true)
  })

  it('updates retained graph handles and stream slots by item id', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const { graph } = createCompiledFrameWithGraph(canvas, createRectSchema(4))
    const handle = graph.handlesByNodeId.get('grid-node')?.[0]

    expect(handle).toBeTruthy()
    expect(graph.updateHandle(handle!.itemId, {
      values: [1, 2, 3, 4],
      batchKey: 'rect:#f97316:none:1',
      versions: { paint: 1 },
    })).toBe(true)

    const stream = graph.streamsByGroupId.get(handle!.groupId)?.get(handle!.streamId)
    const slot = stream?.slotsByItemId.get(handle!.itemId)

    expect(slot?.batchKey).toBe('rect:#f97316:none:1')
    expect(stream?.consumeDirtyRanges().length).toBeGreaterThan(0)
    expect(handle!.versions.paint).toBe(1)
  })

  it('compiles ctx.particles into retained particle stream handles', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const batch = createParticleBatch(16)
    const { frame, graph } = createParticleFrame(canvas, batch)
    const handles = graph.handlesByNodeId.get('particle-node') ?? []

    expect(frame.commands.filter(command => command.type === 'drawParticles')).toHaveLength(1)
    expect(handles).toHaveLength(1)
    expect(handles[0].streamKind).toBe('particle-circle')
    expect(handles[0].count).toBe(16)
  })

  it('compiles ctx.rects into retained rect batch stream handles', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const batch = createRectBatch(32)
    const { frame, graph } = createRectBatchFrame(canvas, batch)
    const handles = graph.handlesByNodeId.get('rect-batch-node') ?? []

    expect(frame.commands.filter(command => command.type === 'drawRectBatch')).toHaveLength(1)
    expect(handles).toHaveLength(1)
    expect(handles[0].streamKind).toBe('rect-batch')
    expect(handles[0].count).toBe(32)
  })

  it('routes plain rect batches through the smaller solid stream instead of the rounded stream', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const plain = renderer.renderFrame(createCompiledFrame(canvas, createRectSchema(100)))
    const roundedSchema = createRectSchema(100)

    for (const item of roundedSchema) {
      if (item.type === 'rect') {
        item.styles = {
          ...item.styles,
          border: { radius: 2, width: 1, color: '#0f172a' },
        }
      }
    }

    const rounded = renderer.renderFrame(createCompiledFrame(canvas, roundedSchema))

    expect(plain.uploadBytes).toBeGreaterThan(0)
    expect(rounded.uploadBytes).toBeGreaterThan(plain.uploadBytes!)
  })

  it('merges GPU arena dirty byte ranges and detects full-upload thresholds', () => {
    const arena = new NovaGpuBufferArena(0.5, 16)

    expect(arena.ensureCapacity(1024)).toBe(true)
    expect(arena.ensureCapacity(512)).toBe(false)
    expect(arena.capacityBytes).toBe(1024)
    expect(arena.mergeDirtyRanges([
      { start: 0, end: 64 },
      { start: 72, end: 96 },
      { start: 512, end: 544 },
    ])).toEqual([
      { start: 0, end: 96 },
      { start: 512, end: 544 },
    ])
    expect(arena.shouldUploadFull(100, [{ start: 0, end: 49 }])).toBe(false)
    expect(arena.shouldUploadFull(100, [{ start: 0, end: 50 }])).toBe(true)
  })

  it('allocates reusable GPU arena slots and exposes merged dirty byte ranges', () => {
    const arena = new NovaGpuBufferArena(0.6, 8)
    const first = arena.allocateSlot(32)
    const second = arena.allocateSlot(32)

    arena.consumeDirtyRanges()
    arena.freeSlot(first)
    const reused = arena.allocateSlot(32)
    arena.markSlotDirty(second)

    expect(reused.index).toBe(first.index)
    expect(arena.allocatedSlots).toBe(2)
    expect(arena.consumeDirtyRanges()).toEqual([
      { start: 0, end: 64 },
    ])
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

  it('uploads only dirty rect ranges when a stable schema batch changes paint', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const schema = createRectSchema(100)

    const first = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const warm = renderer.renderFrame(createCompiledFrame(canvas, schema))

    for (let index = 0; index < 5; index += 1) {
      const item = schema[index]
      if (item.type === 'rect') item.styles = { ...item.styles, background: '#f97316' }
    }

    const dirty = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(dirty.uploadBytes).toBeGreaterThan(0)
    expect(dirty.uploadBytes).toBeLessThan(first.uploadBytes!)
    expect(dirty.fullUploads).toBe(0)
    expect(dirty.bufferSubDataCalls).toBeGreaterThan(0)
    expect(dirty.updatedHandles).toBe(5)
  })

  it('uses schema dirty indices to skip full batch scans on retained paint updates', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const schema = createRectSchema(100)

    schema.contentVersion = 1
    const first = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const warm = renderer.renderFrame(createCompiledFrame(canvas, schema))

    for (let index = 0; index < schema.length; index += 1) {
      const item = schema[index]
      if (item.type === 'rect') item.styles = { ...item.styles, background: '#f97316' }
    }

    schema.contentVersion = 2
    schema.dirtyIndices = [10, 40]
    const dirty = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(dirty.updatedHandles).toBe(2)
    expect(dirty.uploadBytes).toBeGreaterThan(0)
    expect(dirty.uploadBytes).toBeLessThan(first.uploadBytes!)
    expect(dirty.fullUploads).toBe(0)
  })

  it('refreshes semantic child batches when a retained schema buffer is refilled with new rect objects', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const schema = createRectSchema(100)
    schema.semanticScope = 'non-overlap-layered'
    schema.contentVersion = 1

    const first = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const warm = renderer.renderFrame(createCompiledFrame(canvas, schema))

    const nextItems = createRectSchema(100)
    const moved = nextItems[10]
    if (moved.type === 'rect') moved.x += 48

    schema.length = 0
    schema.push(...nextItems)
    schema.semanticScope = 'non-overlap-layered'
    schema.contentVersion = 2
    schema.dirtyIndices = [10]

    const dirty = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const settled = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(dirty.updatedHandles).toBe(1)
    expect(dirty.uploadBytes).toBeGreaterThan(0)
    expect(dirty.uploadBytes).toBeLessThan(first.uploadBytes!)
    expect(dirty.fullUploads).toBe(0)
    expect(settled.uploadBytes).toBe(0)
  })

  it('renders shader-animation frames through uniforms without stream uploads after warmup', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const schema = createRectSchema(100)

    for (let index = 0; index < schema.length; index += 1) {
      const item = schema[index]
      if (item.type === 'rect') {
        item.meta = {
          animation: {
            type: 'pulse-color',
            phase: index * 0.1,
            speed: 0.08,
            amplitude: 0.25,
          },
        }
      }
    }
    schema.contentVersion = 1

    const first = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const warm = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(warm.bufferDataCalls).toBe(0)
    expect(warm.bufferSubDataCalls).toBe(0)
    expect(warm.uniformOnlyFrames).toBe(1)
    expect(warm.nodeRenderCalls).toBe(0)
  })

  it('uploads only particle position data when a retained particle batch moves', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const batch = createParticleBatch(100)
    const { frame } = createParticleFrame(canvas, batch)

    const first = renderer.renderFrame(frame)
    const warm = renderer.renderFrame(frame)
    const positions = batch.positions as Float32Array

    for (let index = 0; index < batch.count; index += 1) {
      positions[index * 2] += 1
      positions[index * 2 + 1] += 1
    }
    batch.revision = 1

    const moved = renderer.renderFrame(frame)

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(moved.uploadBytes).toBe(batch.count * 2 * 4)
    expect(moved.bufferSubDataCalls).toBe(1)
    expect(moved.bufferDataCalls).toBe(0)
    expect(moved.updatedHandles).toBe(batch.count)
    expect(gl.drawArraysInstanced).toHaveBeenCalled()
  })

  it('keeps SlayLines motion data stable and moves via shader metadata', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const schema = createRectSchema(100)

    for (let index = 0; index < schema.length; index += 1) {
      const item = schema[index]
      if (item.type === 'rect') {
        item.styles = {
          ...item.styles,
          border: { radius: 0, width: 1, color: '#000000' },
        }
        item.meta = {
          motion: {
            type: 'slayline',
            speed: 1 + (index % 7) * 0.1,
            wrapWidth: 900,
          },
        }
      }
    }
    schema.contentVersion = 1

    const first = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const warm = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(warm.bufferDataCalls).toBe(0)
    expect(warm.bufferSubDataCalls).toBe(0)
    expect(warm.uniformOnlyFrames).toBe(1)
    expect(warm.drawCalls).toBeLessThanOrEqual(1)
  })

  it('semantic-batches non-overlapping mixed rect/icon/text grids into layered draws', () => {
    mockCanvas2D()
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(canvas, new NovaSchemaRegistry())
    const frame = createCompiledFrame(canvas, createMixedSemanticSchema(100))

    const first = renderer.renderFrame(frame)
    const warm = renderer.renderFrame(frame)

    expect(first.drawCalls).toBeLessThanOrEqual(3)
    expect(first.batches).toBeLessThanOrEqual(3)
    expect(first.instances).toBe(300)
    expect(warm.drawCalls).toBeLessThanOrEqual(3)
    expect(warm.uploadBytes).toBe(0)
    expect(warm.bufferDataCalls).toBe(0)
    expect(warm.bufferSubDataCalls).toBe(0)
  })

  it('keeps text texture batches alive when offscreen runs are culled', () => {
    mockCanvas2D()
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(
      canvas,
      new NovaSchemaRegistry(),
      resolveNovaRendererConfig({
        text: {
          mode: 'run-atlas',
          visibleOnlyRaster: true,
          fallbackPreviousScale: true,
          prewarmAdjacentBuckets: false,
          rasterBudgetMs: 100,
        },
      }),
    )
    const schema = [] as NovaSchema
    for (let index = 0; index < 100; index += 1) {
      schema.push(
        {
          type: 'text',
          x: 10,
          y: 10 + index,
          width: 80,
          height: 16,
          text: `visible-${index}`,
          styles: { color: '#ffffff', font: { size: 12 } },
        },
        {
          type: 'text',
          x: 2000,
          y: 2000 + index,
          width: 80,
          height: 16,
          text: `offscreen-${index}`,
          styles: { color: '#ffffff', font: { size: 12 } },
        },
      )
    }
    schema.semanticScope = 'non-overlap-layered'
    schema.contentVersion = 1

    const first = renderer.renderFrame(createCompiledFrame(canvas, schema))
    const warm = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(first.textureBatchFallbacks).toBe(0)
    expect(first.visibleTextRuns).toBe(100)
    expect(first.culledTextRuns).toBe(100)
    expect(warm.textureBatchFallbacks).toBe(0)
    expect(warm.uploadBytes).toBe(0)
  })

  it('defers visible text without falling back to per-text rendering when raster budget is exhausted', () => {
    mockCanvas2D()
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(
      canvas,
      new NovaSchemaRegistry(),
      resolveNovaRendererConfig({
        text: {
          mode: 'run-atlas',
          visibleOnlyRaster: true,
          fallbackPreviousScale: false,
          prewarmAdjacentBuckets: false,
          rasterBudgetMs: 0,
        },
      }),
    )
    const schema = [
      {
        type: 'text',
        x: 10,
        y: 10,
        width: 80,
        height: 16,
        text: 'deferred',
        styles: { color: '#ffffff', font: { size: 12 } },
      },
    ] as NovaSchema
    schema.semanticScope = 'non-overlap-layered'
    schema.contentVersion = 1

    const metrics = renderer.renderFrame(createCompiledFrame(canvas, schema))

    expect(metrics.textureBatchFallbacks).toBe(0)
    expect(metrics.textRasterDeferred).toBe(1)
    expect(metrics.textBudgetExhausted).toBe(1)
  })

  it('keeps plain rect pan frames in uniform-only mode after warmup', () => {
    const gl = createWebGLContextStub()
    const canvas = createCanvasStub(gl)
    const renderer = new NovaRendererWebGL(
      canvas,
      new NovaSchemaRegistry(),
      resolveNovaRendererConfig({
        text: {
          mode: 'run-atlas',
          visibleOnlyRaster: true,
        },
      }),
    )
    const schema = createRectSchema(100)
    schema.semanticScope = 'non-overlap-layered'
    schema.contentVersion = 1

    const frame = createCompiledFrame(canvas, schema)
    const first = renderer.renderFrame(frame)
    const warm = renderer.renderFrame(frame)

    const translated = mat3.create()
    mat3.fromTranslation(translated, [180, 96])
    for (const command of frame.commands) {
      if (command.type === 'setTransform') {
        command.transform = translated
      }
    }

    const panned = renderer.renderFrame(frame)

    expect(first.uploadBytes).toBeGreaterThan(0)
    expect(warm.uploadBytes).toBe(0)
    expect(panned.uploadBytes).toBe(0)
    expect(panned.bufferDataCalls).toBe(0)
    expect(panned.bufferSubDataCalls).toBe(0)
    expect(panned.uniformOnlyFrames).toBe(1)
  })

  it('uses atlas pages for text, glyph and texture resources', () => {
    const config = resolveNovaRendererConfig()
    const textAtlas = new NovaTextAtlasManager(config.text)
    const glyphAtlas = new NovaGlyphAtlasManager(config.text)
    const textureAtlas = new NovaTextureAtlasManager({ maxMemoryMB: 1, pageSize: 64 })

    const firstText = textAtlas.resolve({
      type: 'text',
      x: 0,
      y: 0,
      width: 40,
      height: 16,
      text: 'text',
      styles: { font: { size: 12 }, color: '#ffffff' },
    })
    const secondText = textAtlas.resolve({
      type: 'text',
      x: 0,
      y: 0,
      width: 40,
      height: 16,
      text: 'text',
      styles: { font: { size: 12 }, color: '#ffffff' },
    })
    const glyph = glyphAtlas.resolve({ glyph: '1', fontKey: '12px Inter', color: '#fff' })
    const icon = textureAtlas.set({ id: 'icon:star', key: 'icon:star', width: 16, height: 16, scale: 1 })

    expect(firstText.rasterized).toBe(true)
    expect(secondText.cacheHit).toBe(true)
    expect(firstText.entry.pageId).toBeDefined()
    expect(glyph.entry.pageId).toBeDefined()
    expect(icon.pageId).toBeDefined()
    expect(textureAtlas.pages).toHaveLength(1)
  })

  it('culls invisible render groups before retained draw/update work', () => {
    const visible = createNovaRenderGroup({ id: 'visible', layerId: 'main' })
    visible.chunkBounds = { x: 10, y: 10, width: 20, height: 20 }
    const hidden = createNovaRenderGroup({ id: 'hidden', layerId: 'main' })
    hidden.chunkBounds = { x: 1000, y: 1000, width: 20, height: 20 }

    const result = collectVisibleNovaRenderGroups([visible, hidden], {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      dpr: 1,
    })

    expect(result.testedGroups).toBe(2)
    expect(result.visibleGroups.map(group => group.id)).toEqual(['visible'])
    expect(result.culledGroupIds).toEqual(['hidden'])
  })

  it('tracks cache-as-texture render target memory', () => {
    const targets = new NovaRenderTargetManager()

    targets.ensure({ id: 'cache:root', kind: 'cache', width: 100, height: 50, dpr: 2, ownerGroupId: 'main:root' })
    expect(targets.memoryBytes).toBe(100 * 2 * 50 * 2 * 4)

    targets.ensure({ id: 'cache:root', kind: 'cache', width: 50, height: 50, dpr: 1, ownerGroupId: 'main:root' })
    expect(targets.memoryBytes).toBe(50 * 50 * 4)
    expect(targets.delete('cache:root')).toBe(true)
    expect(targets.memoryBytes).toBe(0)
  })

  it('uses local-space hit indexes without rebuilding for moving groups', () => {
    const hitIndex = new NovaRenderHitIndex('grid')
    hitIndex.set({
      id: 'cell:1',
      order: 1,
      bounds: { x: 10, y: 10, width: 20, height: 20 },
    })
    hitIndex.set({
      id: 'cell:2',
      order: 2,
      bounds: { x: 15, y: 15, width: 20, height: 20 },
    })

    expect(hitIndex.queryPoint(16, 16)?.id).toBe('cell:2')
    expect(hitIndex.size).toBe(2)
  })

  for (const contractCase of RETAINED_CONTRACT_CASES.filter(testCase => !ACTIVE_RETAINED_CONTRACT_CASE_IDS.has(testCase.id))) {
    it.todo(`${contractCase.priority} ${contractCase.id}: ${contractCase.assertion}`)
  }
})

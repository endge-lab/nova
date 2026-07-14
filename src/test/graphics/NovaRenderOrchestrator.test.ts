import { describe, expect, it, vi } from 'vitest'
import { RendererType } from '@/domain/types/renderer.types'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import { NovaRenderOrchestrator } from '@/model/render/orchestration/NovaRenderOrchestrator'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'

function createMetrics(partial: Partial<NovaRenderMetrics> = {}): NovaRenderMetrics {
  return {
    compilerMs: 0,
    backendMs: 0,
    uploadMs: 0,
    drawMs: 0,
    drawCalls: 0,
    batches: 0,
    bufferDataCalls: 0,
    bufferSubDataCalls: 0,
    compiledGroups: 0,
    commands: 0,
    dirtyRangeCount: 0,
    dirtyStreamRanges: 0,
    fullUploads: 0,
    gpuBufferCapacityBytes: 0,
    items: 0,
    groups: 0,
    nodeRenderCalls: 0,
    textRasterMs: 0,
    textRasterCount: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
    textRasterDeferred: 0,
    textAtlasPages: 0,
    effectiveTextRasterScale: 0,
    atlasUploads: 0,
    uniformOnlyFrames: 0,
    updatedHandles: 0,
    atlasMemoryMB: 0,
    cachedTextureMemoryMB: 0,
    reusedGroups: 0,
    ...partial,
  }
}

function createFrame(metrics: Partial<NovaRenderMetrics> = {}, surfaceId = 'surface'): NovaRenderFrame {
  return {
    id: 1,
    surfaceId,
    rendererType: RendererType.WebGL,
    viewport: {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      dpr: 1,
    },
    layers: [],
    targets: [],
    groups: [],
    items: [],
    commands: [],
    resourceDelta: {
      texturesCreated: 0,
      texturesUpdated: 0,
      texturesEvicted: 0,
      textRunsRasterized: 0,
      bytesUploaded: 0,
    },
    metrics: createMetrics(metrics),
  }
}

function createWebGLBackend(metrics: NovaRenderMetrics = createMetrics({ backendMs: 1 })): NovaRenderBackend {
  return {
    id: 'webgl-test-backend',
    type: RendererType.WebGL,
    novaCanvas: {
      width: 800,
      height: 600,
      pixelWidth: 800,
      pixelHeight: 600,
      dpr: 1,
      maxDpr: 1,
      element: {} as HTMLCanvasElement,
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 } as DOMRectReadOnly),
      invalidate: vi.fn(),
      resize: vi.fn(),
    } as unknown as NovaRenderBackend['novaCanvas'],
    clearRoot: vi.fn(),
    renderFrame: vi.fn(() => metrics),
    destroy: vi.fn(),
  }
}

describe('NovaRenderOrchestrator', () => {
  it('re-enters retained compiler for dirty surfaces so transform updates can patch cached frame', () => {
    const compiledFrame = createFrame({ compilerMs: 3, nodeRenderCalls: 2 })
    const backendMetrics = createMetrics({ backendMs: 1, drawMs: 1, drawCalls: 1 })
    const backend: NovaRenderBackend = {
      clearRoot: vi.fn(),
      renderFrame: vi.fn(() => backendMetrics),
    }
    const orchestrator = new NovaRenderOrchestrator(backend)
    const surface = {
      renderFrameDirty: false,
      compileRenderFrame: vi.fn(() => compiledFrame),
      setRenderMetrics: vi.fn(),
    } as unknown as NovaSurface<any>

    orchestrator.render([surface], new Set([surface]))
    orchestrator.render([surface], new Set([surface]))

    expect(surface.compileRenderFrame).toHaveBeenCalledTimes(2)
    expect(backend.renderFrame).toHaveBeenCalledTimes(2)
    expect(surface.setRenderMetrics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        compilerMs: 3,
        backendMs: 1,
        drawCalls: 1,
      }),
    )
  })

  it('recompiles retained frame when surface render frame is dirty', () => {
    const firstFrame = createFrame({ compilerMs: 2, nodeRenderCalls: 1 })
    const secondFrame = createFrame({ compilerMs: 4, nodeRenderCalls: 3 })
    const backend: NovaRenderBackend = {
      clearRoot: vi.fn(),
      renderFrame: vi.fn(() => createMetrics({ backendMs: 1 })),
    }
    const orchestrator = new NovaRenderOrchestrator(backend)
    const surface = {
      renderFrameDirty: true,
      compileRenderFrame: vi
        .fn()
        .mockReturnValueOnce(firstFrame)
        .mockReturnValueOnce(secondFrame),
      setRenderMetrics: vi.fn(),
    } as unknown as NovaSurface<any>

    orchestrator.render([surface], new Set([surface]))
    orchestrator.render([surface], new Set([surface]))

    expect(surface.compileRenderFrame).toHaveBeenCalledTimes(2)
  })

  it('replays cached frame without compiler when surface stayed clean', () => {
    const compiledFrame = createFrame({ compilerMs: 2, nodeRenderCalls: 1 })
    const backend: NovaRenderBackend = {
      clearRoot: vi.fn(),
      renderFrame: vi.fn(() => createMetrics({ backendMs: 1 })),
    }
    const orchestrator = new NovaRenderOrchestrator(backend)
    const surface = {
      renderFrameDirty: false,
      compileRenderFrame: vi.fn(() => compiledFrame),
      setRenderMetrics: vi.fn(),
    } as unknown as NovaSurface<any>

    orchestrator.render([surface], new Set([surface]))
    orchestrator.render([surface], new Set())

    expect(surface.compileRenderFrame).toHaveBeenCalledTimes(1)
    expect(backend.renderFrame).toHaveBeenCalledTimes(2)
  })

  it('renders WebGL surfaces directly while surface target compositor is disabled', () => {
    const compiledFrame = createFrame({ compilerMs: 2, nodeRenderCalls: 1 })
    const backend = createWebGLBackend()
    const orchestrator = new NovaRenderOrchestrator(backend)
    const surface = {
      renderFrameDirty: false,
      compileRenderFrame: vi.fn(() => compiledFrame),
      setRenderMetrics: vi.fn(),
    } as unknown as NovaSurface<any>

    orchestrator.render([surface], new Set([surface]))
    orchestrator.render([surface], new Set())

    expect(surface.compileRenderFrame).toHaveBeenCalledTimes(1)
    expect(backend.renderFrame).toHaveBeenCalledTimes(2)
    expect(backend.renderFrame).toHaveBeenNthCalledWith(1, compiledFrame)
    expect(backend.renderFrame).toHaveBeenNthCalledWith(2, compiledFrame)
  })

  it('renders WebGL controls and world surfaces directly in z-order', () => {
    const worldFrame = createFrame({ compilerMs: 2, nodeRenderCalls: 1 }, 'root:world')
    const controlsFrame = createFrame({ compilerMs: 1, nodeRenderCalls: 1 }, 'root:controls')
    const backend = createWebGLBackend()
    const orchestrator = new NovaRenderOrchestrator(backend)
    const world = {
      name: 'root:world',
      renderFrameDirty: false,
      compileRenderFrame: vi.fn(() => worldFrame),
      setRenderMetrics: vi.fn(),
    } as unknown as NovaSurface<any>
    const controls = {
      name: 'root:controls',
      renderFrameDirty: false,
      compileRenderFrame: vi.fn(() => controlsFrame),
      setRenderMetrics: vi.fn(),
    } as unknown as NovaSurface<any>

    orchestrator.render([world, controls], new Set([world, controls]))
    orchestrator.render([world, controls], new Set())

    expect(backend.renderFrame).toHaveBeenCalledTimes(4)
    expect(backend.renderFrame).toHaveBeenNthCalledWith(1, worldFrame)
    expect(backend.renderFrame).toHaveBeenNthCalledWith(2, controlsFrame)
    expect(backend.renderFrame).toHaveBeenNthCalledWith(3, worldFrame)
    expect(backend.renderFrame).toHaveBeenNthCalledWith(4, controlsFrame)
  })
})

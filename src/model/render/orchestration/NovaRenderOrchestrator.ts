import type { EventList } from '@endge/utils'
import type {
  NovaRenderCommand,
  NovaRenderFrame,
  NovaRenderMetrics,
  NovaRenderTarget,
} from '@/domain/types/rendering/index'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import { RendererType } from '@/domain/types/renderer.types'

let syntheticFrameId = 0

interface SurfaceRenderCache {
  readonly targetId: string
  frame?: NovaRenderFrame
  target?: NovaRenderTarget
  repainted: boolean
}

interface SurfaceRenderEntry<E extends EventList = EventList> {
  surface: NovaSurface<E>
  frame: NovaRenderFrame
  cache?: SurfaceRenderCache
}

/**
 * Координирует compile/replay логических surfaces в один root backend pass.
 */
export class NovaRenderOrchestrator<E extends EventList = EventList> {
  private readonly _frames = new WeakMap<NovaSurface<E>, NovaRenderFrame>()
  private readonly _surfaceCaches = new WeakMap<NovaSurface<E>, SurfaceRenderCache>()
  private _rootClears = 0
  private _surfaceTargetSeq = 0

  /**
   * Создает orchestrator для единственного app-level backend.
   */
  constructor(private readonly _backend: NovaRenderBackend) {}

  /**
   * Рендерит упорядоченные логические surfaces в root target.
   */
  render(surfaces: Array<NovaSurface<E>>, _dirtySurfaces: ReadonlySet<NovaSurface<E>>): void {
    if (surfaces.length === 0) {
      this._backend.clearRoot()
      this._rootClears += 1
      return
    }

    if (this._shouldCompositeSurfaces()) {
      this._renderWithSurfaceTargets(surfaces, _dirtySurfaces)
      return
    }

    this._backend.resize?.()
    this._backend.clearRoot()
    this._rootClears += 1

    for (const surface of surfaces) {
      const previousFrame = this._frames.get(surface)
      const needsCompile = !previousFrame || _dirtySurfaces.has(surface) || surface.renderFrameDirty
      const frame = needsCompile ? surface.compileRenderFrame() : previousFrame
      this._frames.set(surface, frame)
      const metrics = this._backend.renderFrame(frame)
      surface.setRenderMetrics(this._mergeMetrics(frame.metrics, metrics))
    }
  }

  /**
   * Удаляет retained frame уничтоженного surface.
   */
  deleteSurface(surface: NovaSurface<E>): void {
    this._frames.delete(surface)
    this._surfaceCaches.delete(surface)
  }

  /**
   * Возвращает количество root clear для тестов и diagnostics.
   */
  get rootClears(): number {
    return this._rootClears
  }

  /**
   * Сохраняет compiler metrics, когда backend возвращает draw metrics.
   */
  private _mergeMetrics(compiler: NovaRenderMetrics, backend: NovaRenderMetrics): NovaRenderMetrics {
    return {
      ...compiler,
      ...backend,
      compilerMs: compiler.compilerMs,
      commands: compiler.commands,
      items: compiler.items,
      groups: compiler.groups,
    }
  }

  /**
   * WebGL backend может композитить surfaces через cached render targets.
   */
  private _shouldCompositeSurfaces(): boolean {
    // Surface-target compositing is intentionally disabled for now: the current
    // full-canvas texture path corrupts DPR/WebGL UI scenes with icon/text
    // artefacts. Resident per-batch caches stay active in the backend.
    return false
  }

  /**
   * Рендерит dirty surfaces в offscreen targets и собирает root из cached textures.
   */
  private _renderWithSurfaceTargets(surfaces: Array<NovaSurface<E>>, dirtySurfaces: ReadonlySet<NovaSurface<E>>): void {
    this._backend.resize?.()

    const entries: Array<SurfaceRenderEntry<E>> = []
    for (const surface of surfaces) {
      const cache = this._shouldCacheSurface(surface) ? this._ensureSurfaceCache(surface) : undefined
      const previousFrame = cache?.frame ?? this._frames.get(surface)
      const needsCompile = !previousFrame || dirtySurfaces.has(surface) || surface.renderFrameDirty
      const frame = needsCompile ? surface.compileRenderFrame() : previousFrame

      this._frames.set(surface, frame)
      if (!cache) {
        entries.push({ surface, frame })
        continue
      }

      cache.frame = frame
      const nextTarget = this._createSurfaceTarget(cache)
      const targetChanged = this._hasTargetChanged(cache.target, nextTarget)
      if (needsCompile || targetChanged || !cache.repainted) {
        cache.target = nextTarget
        const targetFrame = this._wrapFrameInRenderTarget(frame, nextTarget)
        const metrics = this._backend.renderFrame(targetFrame)
        surface.setRenderMetrics(this._mergeMetrics(frame.metrics, metrics))
        cache.repainted = true
      }
      else {
        cache.target = nextTarget
      }

      entries.push({ surface, frame, cache })
    }

    this._backend.clearRoot()
    this._rootClears += 1
    this._renderCompositeEntries(entries)
  }

  /**
   * Рисует cached chunks и direct surfaces в исходном z-order.
   */
  private _renderCompositeEntries(entries: Array<SurfaceRenderEntry<E>>): void {
    let pendingCaches: Array<SurfaceRenderCache> = []
    const flushPendingCaches = (): void => {
      if (pendingCaches.length === 0) {
        return
      }
      this._backend.renderFrame(this._createCompositeFrame(pendingCaches))
      pendingCaches = []
    }

    for (const entry of entries) {
      if (entry.cache) {
        pendingCaches.push(entry.cache)
        continue
      }

      flushPendingCaches()
      const metrics = this._backend.renderFrame(entry.frame)
      entry.surface.setRenderMetrics(this._mergeMetrics(entry.frame.metrics, metrics))
    }

    flushPendingCaches()
  }

  /**
   * Screen-space controls stay direct to avoid texture-target artefacts on UI icons.
   */
  private _shouldCacheSurface(surface: NovaSurface<E>): boolean {
    return !String(surface.name ?? '').endsWith(':controls')
  }

  /**
   * Создает или возвращает retained metadata для surface target.
   */
  private _ensureSurfaceCache(surface: NovaSurface<E>): SurfaceRenderCache {
    const current = this._surfaceCaches.get(surface)
    if (current) {
      return current
    }

    const cache: SurfaceRenderCache = {
      targetId: `nova:surface-cache:${++this._surfaceTargetSeq}`,
      repainted: false,
    }
    this._surfaceCaches.set(surface, cache)
    return cache
  }

  /**
   * Создает target под текущий canvas size.
   */
  private _createSurfaceTarget(cache: SurfaceRenderCache): NovaRenderTarget {
    const canvas = this._backend.novaCanvas
    return {
      id: cache.targetId,
      kind: 'cache',
      width: Math.max(1, canvas.width),
      height: Math.max(1, canvas.height),
      dpr: Math.max(0.01, canvas.dpr ?? 1),
    }
  }

  /**
   * Проверяет, нужно ли repaint-ить cache target из-за resize/DPR.
   */
  private _hasTargetChanged(previous: NovaRenderTarget | undefined, next: NovaRenderTarget): boolean {
    return !previous
      || previous.width !== next.width
      || previous.height !== next.height
      || previous.dpr !== next.dpr
      || previous.kind !== next.kind
  }

  /**
   * Оборачивает surface frame в begin/end render target.
   */
  private _wrapFrameInRenderTarget(frame: NovaRenderFrame, target: NovaRenderTarget): NovaRenderFrame {
    const begin: NovaRenderCommand = {
      id: `${target.id}:begin:${frame.id}`,
      type: 'beginRenderTarget',
      order: -1,
      target,
      targetId: target.id,
    }
    const end: NovaRenderCommand = {
      id: `${target.id}:end:${frame.id}`,
      type: 'endRenderTarget',
      order: Number.MAX_SAFE_INTEGER,
    }

    return {
      ...frame,
      id: ++syntheticFrameId,
      surfaceId: `${frame.surfaceId}:surface-cache`,
      targets: [target, ...frame.targets],
      commands: [begin, ...frame.commands, end],
      metrics: {
        ...frame.metrics,
        commands: frame.metrics.commands + 2,
      },
    }
  }

  /**
   * Создает frame, который рисует все surface targets в root target.
   */
  private _createCompositeFrame(caches: Array<SurfaceRenderCache>): NovaRenderFrame {
    const canvas = this._backend.novaCanvas
    const width = Math.max(1, canvas.width)
    const height = Math.max(1, canvas.height)
    const commands: Array<NovaRenderCommand> = []
    const targets: Array<NovaRenderTarget> = []

    for (const cache of caches) {
      const target = cache.target
      if (!target) {
        continue
      }
      targets.push(target)
      commands.push({
        id: `${target.id}:draw:${commands.length + 1}`,
        type: 'drawRenderTarget',
        order: commands.length + 1,
        targetId: target.id,
        x: 0,
        y: 0,
        width,
        height,
      })
    }

    return {
      id: ++syntheticFrameId,
      surfaceId: 'nova:surface-cache:composite',
      rendererType: RendererType.WebGL,
      viewport: {
        x: 0,
        y: 0,
        width,
        height,
        dpr: Math.max(0.01, canvas.dpr ?? 1),
      },
      layers: [],
      targets,
      groups: [],
      items: [],
      commands,
      resourceDelta: {
        texturesCreated: 0,
        texturesUpdated: 0,
        texturesEvicted: 0,
        textRunsRasterized: 0,
        bytesUploaded: 0,
      },
      metrics: this._createEmptyMetrics(commands.length),
    }
  }

  /**
   * Создает минимальные render metrics для synthetic composite frame.
   */
  private _createEmptyMetrics(commands: number): NovaRenderMetrics {
    return {
      compilerMs: 0,
      backendMs: 0,
      uploadMs: 0,
      drawMs: 0,
      drawCalls: 0,
      batches: 0,
      bufferDataCalls: 0,
      bufferSubDataCalls: 0,
      schemaResidentBatchHits: 0,
      schemaResidentBatchMisses: 0,
      schemaResidentBatchUploads: 0,
      compiledGroups: 0,
      commands,
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
    }
  }
}

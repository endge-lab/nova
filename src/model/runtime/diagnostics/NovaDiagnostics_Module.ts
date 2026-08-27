import type { EventList } from '@endge/utils'
import type {
  NovaDiagnosticsAvailability,
  NovaDiagnosticsBrowserSnapshot,
  NovaDiagnosticsCategory,
  NovaDiagnosticsFrameSnapshot,
  NovaDiagnosticsInputSnapshot,
  NovaDiagnosticsOptions,
  NovaDiagnosticsRenderSnapshot,
  NovaDiagnosticsResourceSnapshot,
  NovaDiagnosticsRuntimeSnapshot,
  NovaDiagnosticsSnapshot,
} from '@/domain/types/diagnostics.types'
import type { NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { DiagnosticsPerformance } from '@/model/runtime/diagnostics/adapters/NovaDiagnosticsBrowser_Adapter'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import { NovaDiagnosticsBrowser_Adapter } from '@/model/runtime/diagnostics/adapters/NovaDiagnosticsBrowser_Adapter'

const DEFAULT_SAMPLE_INTERVAL_MS = 1000
const DEFAULT_HISTORY_LIMIT = 120
const ALL_CATEGORIES: Array<NovaDiagnosticsCategory> = [
  'runtime',
  'frame',
  'render',
  'resources',
  'browser',
  'input',
  'history',
]

/**
 * Описывает callbacks, которыми diagnostics управляет внешними runtime-сервисами.
 */
export interface NovaDiagnosticsRuntimeHooks {
  setRendererDiagnosticsEnabled: (enabled: boolean) => void
}

/**
 * Собирает diagnostics NovaApp только при включенном runtime-флаге.
 */
export class NovaDiagnostics_Module<E extends EventList = EventList> {
  private _options = this.resolveOptions()
  private readonly _categories = new Set<NovaDiagnosticsCategory>(ALL_CATEGORIES)
  private _frameIndex = 0
  private _frameStartedAt = 0
  private _phaseStartedAt = 0
  private _phaseName = ''
  private _dirtyNodes = 0
  private _dirtyRenderNodes = 0
  private _lastFrame: NovaDiagnosticsFrameSnapshot = createEmptyFrameSnapshot()
  private _browser: NovaDiagnosticsBrowserSnapshot = {}
  private _history: Array<NovaDiagnosticsSnapshot> = []
  private _browserTimerId: ReturnType<typeof setInterval> | null = null
  private _longTaskObserver: PerformanceObserver | null = null
  private _longTasks = 0
  private _longTaskMs = 0
  private _samplingBrowser = false
  private readonly _phaseDurations: Record<string, number> = {}

  /**
   * Создает diagnostics module для конкретного NovaApp.
   */
  constructor(
    private readonly _app: NovaApp<E>,
    private readonly _hooks: NovaDiagnosticsRuntimeHooks,
    private readonly _browserAdapter: NovaDiagnosticsBrowser_Adapter = new NovaDiagnosticsBrowser_Adapter(),
  ) {}

  /**
   * Возвращает активность diagnostics.
   */
  get enabled(): boolean {
    return this._options.enabled === true
  }

  /**
   * Возвращает текущие настройки diagnostics.
   */
  get options(): Required<NovaDiagnosticsOptions> {
    return this._options
  }

  /**
   * Возвращает накопленную history последних snapshots.
   */
  get history(): Array<NovaDiagnosticsSnapshot> {
    return [...this._history]
  }

  /**
   * Применяет новые настройки diagnostics.
   */
  configure(options: NovaDiagnosticsOptions | undefined): void {
    const wasEnabled = this.enabled
    const next = this.resolveOptions(options, this._options)

    this._categories.clear()
    for (const category of next.categories) {
      this._categories.add(category)
    }

    this._options = next
    this._hooks.setRendererDiagnosticsEnabled(this.enabled && this.hasCategory('render'))

    if (!wasEnabled && this.enabled) {
      this.startCollectors()
    }
    else if (wasEnabled && !this.enabled) {
      this.stopCollectors()
      this.resetRuntimeState()
    }
    else if (this.enabled) {
      this.restartBrowserCollectors()
    }
  }

  /**
   * Проверяет активность категории.
   */
  hasCategory(category: NovaDiagnosticsCategory): boolean {
    return this.enabled && this._categories.has(category)
  }

  /**
   * Помечает начало frame diagnostics.
   */
  frameStart(now = this._browserAdapter.now()): void {
    if (!this.enabled) {
      return
    }
    this._frameStartedAt = now
    this._dirtyNodes = 0
    this._dirtyRenderNodes = 0
    for (const key of Object.keys(this._phaseDurations)) {
      delete this._phaseDurations[key]
    }
  }

  /**
   * Помечает конец frame diagnostics и сохраняет snapshot.
   */
  frameEnd(now = this._browserAdapter.now()): void {
    if (!this.enabled) {
      return
    }

    this._lastFrame = {
      index: ++this._frameIndex,
      lastMs: this._frameStartedAt > 0 ? now - this._frameStartedAt : 0,
      phases: { ...this._phaseDurations },
      dirtyNodes: this._dirtyNodes,
      dirtyRenderNodes: this._dirtyRenderNodes,
      renderedAt: now,
    }

    if (this.hasCategory('history')) {
      this._history.push(this.snapshot(now))
      while (this._history.length > this._options.historyLimit) {
        this._history.shift()
      }
    }
  }

  /**
   * Помечает начало runtime phase.
   */
  phaseStart(name: string, now = this._browserAdapter.now()): void {
    if (!this.enabled || !this.hasCategory('frame')) {
      return
    }
    this._phaseName = name
    this._phaseStartedAt = now
  }

  /**
   * Помечает конец runtime phase.
   */
  phaseEnd(now = this._browserAdapter.now()): void {
    if (!this.enabled || !this.hasCategory('frame') || !this._phaseName) {
      return
    }
    const duration = Math.max(0, now - this._phaseStartedAt)
    this._phaseDurations[this._phaseName] = (this._phaseDurations[this._phaseName] ?? 0) + duration
    this._phaseName = ''
    this._phaseStartedAt = 0
  }

  /**
   * Сохраняет размер dirty workload для текущей Raph phase.
   */
  recordDirtyNodes(count: number): void {
    if (!this.enabled || !this.hasCategory('frame')) {
      return
    }
    this._dirtyNodes = Math.max(this._dirtyNodes, count)
  }

  /**
   * Сохраняет размер render dirty workload для текущего frame.
   */
  recordDirtyRenderNodes(count: number): void {
    if (!this.enabled || !this.hasCategory('frame')) {
      return
    }
    this._dirtyRenderNodes = Math.max(this._dirtyRenderNodes, count)
  }

  /**
   * Возвращает текущий diagnostics snapshot.
   */
  snapshot(now = this._browserAdapter.now()): NovaDiagnosticsSnapshot {
    return {
      runtime: this.collectRuntime(now),
      frame: this.enabled ? this._lastFrame : createEmptyFrameSnapshot(),
      render: this.enabled && this.hasCategory('render') ? this.collectRender() : createEmptyRenderSnapshot(),
      resources: this.enabled && this.hasCategory('resources') ? this.collectResources() : createEmptyResourceSnapshot(),
      browser: this.enabled && this.hasCategory('browser') ? { ...this._browser } : {},
      input: this.enabled && this.hasCategory('input') ? this.collectInput() : { hitTestMode: 'unknown', lastHitTestCandidates: 0 },
      availability: this.collectAvailability(),
    }
  }

  /**
   * Освобождает diagnostics timers и observers.
   */
  destroy(): void {
    this.stopCollectors()
    this._history = []
  }

  /**
   * Запускает runtime collectors.
   */
  private startCollectors(): void {
    this._app.metrics.start()
    this._hooks.setRendererDiagnosticsEnabled(this.hasCategory('render'))
    this.restartBrowserCollectors()
  }

  /**
   * Останавливает runtime collectors.
   */
  private stopCollectors(): void {
    this._app.metrics.stop()
    this._hooks.setRendererDiagnosticsEnabled(false)
    this.stopBrowserCollectors()
  }

  /**
   * Перезапускает browser collectors после изменения настроек.
   */
  private restartBrowserCollectors(): void {
    this.stopBrowserCollectors()
    if (!this.enabled || !this._options.browser || !this.hasCategory('browser')) {
      return
    }

    this.sampleBrowser()
    this.startLongTaskObserver()
    if (typeof setInterval !== 'undefined') {
      this._browserTimerId = setInterval(() => this.sampleBrowser(), this._options.sampleIntervalMs)
    }
  }

  /**
   * Останавливает browser collectors.
   */
  private stopBrowserCollectors(): void {
    if (this._browserTimerId !== null && typeof clearInterval !== 'undefined') {
      clearInterval(this._browserTimerId)
    }
    this._browserTimerId = null
    this._longTaskObserver?.disconnect()
    this._longTaskObserver = null
    this._samplingBrowser = false
  }

  /**
   * Сбрасывает mutable state, который не должен жить при выключенной диагностике.
   */
  private resetRuntimeState(): void {
    this._frameStartedAt = 0
    this._phaseStartedAt = 0
    this._phaseName = ''
    this._dirtyNodes = 0
    this._dirtyRenderNodes = 0
    this._lastFrame = createEmptyFrameSnapshot()
    this._browser = {}
    this._history = []
    this._longTasks = 0
    this._longTaskMs = 0
    for (const key of Object.keys(this._phaseDurations)) {
      delete this._phaseDurations[key]
    }
  }

  /**
   * Читает browser-level метрики, если runtime API доступны.
   */
  private sampleBrowser(): void {
    if (this._samplingBrowser) {
      return
    }
    this._samplingBrowser = true

    const perf: DiagnosticsPerformance | undefined = this._browserAdapter.performance()
    const browser: NovaDiagnosticsBrowserSnapshot = {
      lastSampledAt: perf?.now() ?? Date.now(),
      longTasks: this._longTasks,
      longTaskMs: this._longTaskMs,
      resources: perf?.getEntriesByType?.('resource').length,
    }

    const memory = perf?.memory
    if (memory) {
      browser.jsHeapUsedMB = bytesToMB(memory.usedJSHeapSize)
      browser.jsHeapTotalMB = memory.totalJSHeapSize !== undefined ? bytesToMB(memory.totalJSHeapSize) : undefined
      browser.jsHeapLimitMB = memory.jsHeapSizeLimit !== undefined ? bytesToMB(memory.jsHeapSizeLimit) : undefined
    }

    const dom = this._browserAdapter.sampleDom()
    if (dom) {
      Object.assign(browser, dom)
    }

    this._browser = browser

    if (perf?.measureUserAgentSpecificMemory) {
      void perf.measureUserAgentSpecificMemory()
        .then((result) => {
          if (!this.enabled) {
            return undefined
          }
          this._browser = {
            ...this._browser,
            userAgentMemoryMB: bytesToMB(result.bytes),
          }
          return undefined
        })
        .catch(() => undefined)
        .finally(() => {
          this._samplingBrowser = false
        })
      return
    }

    this._samplingBrowser = false
  }

  /**
   * Запускает observer long task API, если браузер его поддерживает.
   */
  private startLongTaskObserver(): void {
    this._longTaskObserver = this._browserAdapter.observeLongTasks((duration) => {
      this._longTasks += 1
      this._longTaskMs += duration
    })
  }

  /**
   * Собирает runtime snapshot.
   */
  private collectRuntime(now: number): NovaDiagnosticsRuntimeSnapshot {
    const appMetrics = this.enabled ? this._app.metrics.snapshot(now) : undefined

    return {
      enabled: this.enabled,
      fps: appMetrics?.fps ?? 0,
      renderFps: appMetrics?.rFps ?? 0,
      ups: appMetrics?.ups ?? 0,
      idleMs: appMetrics?.idle ?? 0,
      surfaces: this._app.surfaces.length,
      dirtySurfaces: this._app.dirtySurfaceCount,
      nodes: this.enabled && this.hasCategory('runtime') ? countNodes(this._app.raph.root as unknown as NovaNode<E>) : 0,
      width: this._app.width,
      height: this._app.height,
      dpr: this._app.dpr,
      loop: this._app.raph.loopEnabled,
    }
  }

  /**
   * Собирает render snapshot по последним surface metrics.
   */
  private collectRender(): NovaDiagnosticsRenderSnapshot {
    const stats = collectSurfaceMetrics(this._app.surfaces.map(surface => surface.renderMetrics))
    const compileStats = this._app.surfaces.reduce((total, surface) => {
      total.rebuiltNodes += surface.renderCompileStats.rebuiltNodes
      total.cachedNodes += surface.renderCompileStats.cachedNodes
      total.culledNodes += surface.renderCullingStats.culledNodes
      total.cullingTests += surface.renderCullingStats.testedNodes
      return total
    }, { rebuiltNodes: 0, cachedNodes: 0, culledNodes: 0, cullingTests: 0 })

    return {
      compilerMs: stats.compilerMs,
      backendMs: stats.backendMs,
      uploadMs: stats.uploadMs,
      drawMs: stats.drawMs,
      drawCalls: stats.drawCalls,
      batches: stats.batches,
      commands: stats.commands,
      items: stats.items,
      groups: stats.groups,
      uploadBytes: stats.uploadBytes ?? 0,
      bufferDataCalls: stats.bufferDataCalls ?? 0,
      bufferSubDataCalls: stats.bufferSubDataCalls ?? 0,
      fullUploads: stats.fullUploads ?? 0,
      dirtyRangeCount: stats.dirtyRangeCount ?? 0,
      nodeRenderCalls: stats.nodeRenderCalls ?? 0,
      updatedHandles: stats.updatedHandles ?? 0,
      dirtyStreamRanges: stats.dirtyStreamRanges ?? 0,
      rebuiltNodes: compileStats.rebuiltNodes,
      cachedNodes: compileStats.cachedNodes,
      culledNodes: compileStats.culledNodes,
      cullingTests: compileStats.cullingTests,
      textRasterCount: stats.textRasterCount ?? 0,
      textRasterPixels: stats.textRasterPixels ?? 0,
      textRasterBytes: stats.textRasterBytes ?? 0,
      textRasterBoxPixels: stats.textRasterBoxPixels ?? 0,
      textRasterSavedPixels: stats.textRasterSavedPixels ?? 0,
      textRasterMs: stats.textRasterMs,
    }
  }

  /**
   * Собирает resource snapshot по расчетным ресурсам Nova.
   */
  private collectResources(): NovaDiagnosticsResourceSnapshot {
    const stats = collectSurfaceMetrics(this._app.surfaces.map(surface => surface.renderMetrics))
    const textureMB = stats.atlasMemoryMB
    const cachedTextureMB = stats.cachedTextureMemoryMB
    const bufferMB = bytesToMB(stats.gpuBufferCapacityBytes ?? 0)
    const canvasMB = bytesToMB(this._app.width * this._app.height * this._app.dpr * this._app.dpr * 4)
    const estimatedGpuMemoryMB = textureMB + cachedTextureMB + bufferMB + canvasMB

    return {
      estimatedGpuMemoryMB,
      estimatedTextureMemoryMB: textureMB,
      estimatedTextAtlasMemoryMB: textureMB,
      estimatedCachedTextureMemoryMB: cachedTextureMB,
      estimatedBufferMemoryMB: bufferMB,
      estimatedCanvasMemoryMB: canvasMB,
      textAtlasPages: stats.textAtlasPages ?? 0,
      glyphAtlasPages: stats.glyphAtlasPages ?? 0,
      textAtlasEvictions: stats.textAtlasEvictions ?? 0,
      glyphAtlasEvictions: stats.glyphAtlasEvictions ?? 0,
      textureBatchFallbacks: stats.textureBatchFallbacks ?? 0,
      atlasUploads: stats.atlasUploads ?? 0,
    }
  }

  /**
   * Собирает input snapshot.
   */
  private collectInput(): NovaDiagnosticsInputSnapshot {
    return {
      hitTestMode: this._app.events.hitTestMode,
      hitTestIndexPolicy: this._app.events.hitTestIndexPolicy,
      lastHitTestCandidates: this._app.events.lastHitTestCandidates,
      cursorLastHitTestCandidates: this._app.cursors.lastHitTestCandidates,
      hitTestIndexedNodes: this._app.events.hitTestIndexedNodeCount,
      cursorIndexedNodes: this._app.cursors.hitTestIndexedNodeCount,
    }
  }

  /**
   * Возвращает карту доступности diagnostics данных.
   */
  private collectAvailability(): NovaDiagnosticsAvailability {
    const browserEnabled = this.enabled && this.hasCategory('browser')
    const perf: DiagnosticsPerformance | undefined = this._browserAdapter.performance()

    return {
      runtime: this.enabled && this.hasCategory('runtime') ? 'exact' : 'unavailable',
      frame: this.enabled && this.hasCategory('frame') ? 'exact' : 'unavailable',
      render: this.enabled && this.hasCategory('render') ? 'exact' : 'unavailable',
      resources: this.enabled && this.hasCategory('resources') ? 'estimated' : 'unavailable',
      browserHeap: browserEnabled && perf?.memory ? 'observed' : 'unavailable',
      browserMemory: browserEnabled && perf?.measureUserAgentSpecificMemory ? 'observed' : 'unavailable',
      browserDom: browserEnabled && this._browserAdapter.hasDom() ? 'observed' : 'unavailable',
      browserLongTasks: browserEnabled && this._browserAdapter.hasLongTaskObserver() ? 'observed' : 'unavailable',
      gpuProcessMemory: 'unavailable',
    }
  }

  /**
   * Нормализует options diagnostics.
   */
  private resolveOptions(
    input: NovaDiagnosticsOptions = {},
    base?: Required<NovaDiagnosticsOptions>,
  ): Required<NovaDiagnosticsOptions> {
    const categories = input.categories ?? base?.categories ?? ALL_CATEGORIES

    return {
      enabled: input.enabled ?? base?.enabled ?? false,
      browser: input.browser ?? base?.browser ?? true,
      sampleIntervalMs: Math.max(250, input.sampleIntervalMs ?? base?.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS),
      historyLimit: Math.max(0, input.historyLimit ?? base?.historyLimit ?? DEFAULT_HISTORY_LIMIT),
      categories: categories.length > 0 ? [...categories] : [...ALL_CATEGORIES],
    }
  }
}

/**
 * Создает пустой frame snapshot.
 */
function createEmptyFrameSnapshot(): NovaDiagnosticsFrameSnapshot {
  return {
    index: 0,
    lastMs: 0,
    phases: {},
    dirtyNodes: 0,
    dirtyRenderNodes: 0,
    renderedAt: 0,
  }
}

/**
 * Создает пустой render snapshot.
 */
function createEmptyRenderSnapshot(): NovaDiagnosticsRenderSnapshot {
  return {
    compilerMs: 0,
    backendMs: 0,
    uploadMs: 0,
    drawMs: 0,
    drawCalls: 0,
    batches: 0,
    commands: 0,
    items: 0,
    groups: 0,
    uploadBytes: 0,
    bufferDataCalls: 0,
    bufferSubDataCalls: 0,
    fullUploads: 0,
    dirtyRangeCount: 0,
    nodeRenderCalls: 0,
    updatedHandles: 0,
    dirtyStreamRanges: 0,
    rebuiltNodes: 0,
    cachedNodes: 0,
    culledNodes: 0,
    cullingTests: 0,
    textRasterCount: 0,
    textRasterPixels: 0,
    textRasterBytes: 0,
    textRasterBoxPixels: 0,
    textRasterSavedPixels: 0,
    textRasterMs: 0,
  }
}

/**
 * Создает пустой resource snapshot.
 */
function createEmptyResourceSnapshot(): NovaDiagnosticsResourceSnapshot {
  return {
    estimatedGpuMemoryMB: 0,
    estimatedTextureMemoryMB: 0,
    estimatedTextAtlasMemoryMB: 0,
    estimatedCachedTextureMemoryMB: 0,
    estimatedBufferMemoryMB: 0,
    estimatedCanvasMemoryMB: 0,
    textAtlasPages: 0,
    glyphAtlasPages: 0,
    textAtlasEvictions: 0,
    glyphAtlasEvictions: 0,
    textureBatchFallbacks: 0,
    atlasUploads: 0,
  }
}

/**
 * Суммирует surface render metrics.
 */
function collectSurfaceMetrics(metrics: Array<NovaRenderMetrics | null>): NovaRenderMetrics {
  const result = {
    compilerMs: 0,
    backendMs: 0,
    uploadMs: 0,
    drawMs: 0,
    drawCalls: 0,
    batches: 0,
    commands: 0,
    items: 0,
    groups: 0,
    textRasterMs: 0,
    atlasMemoryMB: 0,
    cachedTextureMemoryMB: 0,
  } as NovaRenderMetrics

  for (const item of metrics) {
    if (!item) {
      continue
    }
    for (const [key, value] of Object.entries(item)) {
      if (typeof value !== 'number') {
        continue
      }
      const metricKey = key as keyof NovaRenderMetrics
      const current = typeof result[metricKey] === 'number' ? result[metricKey] : 0
      ;(result as unknown as Record<string, number>)[key] = current + value
    }
  }

  return result
}

/**
 * Считает количество nodes в runtime tree.
 */
function countNodes(node: NovaNode<any> | null | undefined): number {
  if (!node) {
    return 0
  }
  let total = 1
  for (const child of node.children as Array<NovaNode<any>>) {
    total += countNodes(child)
  }
  return total
}

/**
 * Переводит bytes в MB.
 */
function bytesToMB(value: number): number {
  return value / 1024 / 1024
}

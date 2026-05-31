/**
 * Описывает источник и точность диагностической метрики.
 */
export type NovaDiagnosticsMetricSource = 'exact' | 'estimated' | 'observed' | 'unavailable'

/**
 * Описывает категорию runtime diagnostics.
 */
export type NovaDiagnosticsCategory =
  | 'runtime'
  | 'frame'
  | 'render'
  | 'resources'
  | 'browser'
  | 'input'
  | 'history'

/**
 * Описывает доступность группы диагностических данных.
 */
export interface NovaDiagnosticsAvailability {
  runtime: NovaDiagnosticsMetricSource
  frame: NovaDiagnosticsMetricSource
  render: NovaDiagnosticsMetricSource
  resources: NovaDiagnosticsMetricSource
  browserHeap: NovaDiagnosticsMetricSource
  browserMemory: NovaDiagnosticsMetricSource
  browserDom: NovaDiagnosticsMetricSource
  browserLongTasks: NovaDiagnosticsMetricSource
  gpuProcessMemory: NovaDiagnosticsMetricSource
}

/**
 * Описывает настройки diagnostics runtime.
 */
export interface NovaDiagnosticsOptions {
  enabled?: boolean
  browser?: boolean
  sampleIntervalMs?: number
  historyLimit?: number
  categories?: Array<NovaDiagnosticsCategory>
}

/**
 * Описывает runtime-счетчики NovaApp.
 */
export interface NovaDiagnosticsRuntimeSnapshot {
  enabled: boolean
  fps: number
  renderFps: number
  ups: number
  idleMs: number
  surfaces: number
  dirtySurfaces: number
  nodes: number
  width: number
  height: number
  dpr: number
  loop: boolean
}

/**
 * Описывает timings последнего frame.
 */
export interface NovaDiagnosticsFrameSnapshot {
  index: number
  lastMs: number
  phases: Record<string, number>
  dirtyNodes: number
  dirtyRenderNodes: number
  renderedAt: number
}

/**
 * Описывает renderer counters последнего replay.
 */
export interface NovaDiagnosticsRenderSnapshot {
  compilerMs: number
  backendMs: number
  uploadMs: number
  drawMs: number
  drawCalls: number
  batches: number
  commands: number
  items: number
  groups: number
  uploadBytes: number
  bufferDataCalls: number
  bufferSubDataCalls: number
  fullUploads: number
  dirtyRangeCount: number
  nodeRenderCalls: number
  updatedHandles: number
  dirtyStreamRanges: number
  rebuiltNodes: number
  cachedNodes: number
  culledNodes: number
  cullingTests: number
  textRasterCount: number
  textRasterPixels: number
  textRasterBytes: number
  textRasterBoxPixels: number
  textRasterSavedPixels: number
  textRasterMs: number
}

/**
 * Описывает расчетные ресурсы, которыми владеет Nova runtime.
 */
export interface NovaDiagnosticsResourceSnapshot {
  estimatedGpuMemoryMB: number
  estimatedTextureMemoryMB: number
  estimatedTextAtlasMemoryMB: number
  estimatedCachedTextureMemoryMB: number
  estimatedBufferMemoryMB: number
  estimatedCanvasMemoryMB: number
  textAtlasPages: number
  glyphAtlasPages: number
  textAtlasEvictions: number
  glyphAtlasEvictions: number
  textureBatchFallbacks: number
  atlasUploads: number
}

/**
 * Описывает наблюдаемые браузерные метрики.
 */
export interface NovaDiagnosticsBrowserSnapshot {
  jsHeapUsedMB?: number
  jsHeapTotalMB?: number
  jsHeapLimitMB?: number
  userAgentMemoryMB?: number
  domNodes?: number
  documents?: number
  frames?: number
  longTasks?: number
  longTaskMs?: number
  resources?: number
  lastSampledAt?: number
}

/**
 * Описывает input diagnostics.
 */
export interface NovaDiagnosticsInputSnapshot {
  hitTestMode: string
  hitTestIndexPolicy?: string
  lastHitTestCandidates: number
  cursorLastHitTestCandidates?: number
  hitTestIndexedNodes?: number
  cursorIndexedNodes?: number
}

/**
 * Описывает полный diagnostics snapshot.
 */
export interface NovaDiagnosticsSnapshot {
  runtime: NovaDiagnosticsRuntimeSnapshot
  frame: NovaDiagnosticsFrameSnapshot
  render: NovaDiagnosticsRenderSnapshot
  resources: NovaDiagnosticsResourceSnapshot
  browser: NovaDiagnosticsBrowserSnapshot
  input: NovaDiagnosticsInputSnapshot
  availability: NovaDiagnosticsAvailability
}

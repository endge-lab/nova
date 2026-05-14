import type { mat3 } from 'gl-matrix'
import type {
  NovaBounds,
  NovaIconBatch,
  NovaParticleBatch,
  NovaRectBatch,
  NovaSemanticScopeKind,
  NovaSchemaItem,
  NovaStripeRectBatch,
  NovaTextBatch,
  RendererType,
} from '@/domain/types/renderer.types'

/**
 * Описывает тип NovaRenderLayerId.
 */
export type NovaRenderLayerId = 'main' | 'overlay' | 'selection' | 'drag-preview' | 'debug' | string
/**
 * Описывает тип NovaRenderTargetId.
 */
export type NovaRenderTargetId = string
/**
 * Описывает тип NovaRenderGroupId.
 */
export type NovaRenderGroupId = string
/**
 * Описывает тип NovaRenderItemId.
 */
export type NovaRenderItemId = string
/**
 * Описывает тип NovaRenderHandleId.
 */
export type NovaRenderHandleId = string
/**
 * Описывает тип NovaRenderStreamId.
 */
export type NovaRenderStreamId = string

/**
 * Описывает тип NovaRenderPolicyGroup.
 */
export type NovaRenderPolicyGroup = 'auto' | 'always' | 'never'
/**
 * Описывает тип NovaRenderPolicyCache.
 */
export type NovaRenderPolicyCache = 'auto' | 'texture' | 'none'
/**
 * Описывает тип NovaRenderPolicyTextQuality.
 */
export type NovaRenderPolicyTextQuality = 'auto' | 'crisp' | 'performance'
/**
 * Описывает тип NovaRenderPolicyUpdateMode.
 */
export type NovaRenderPolicyUpdateMode = 'static' | 'dynamic' | 'stream'
/**
 * Описывает тип NovaRenderPolicyLayer.
 */
export type NovaRenderPolicyLayer = 'auto' | 'main' | 'overlay' | 'debug' | NovaRenderLayerId

/**
 * Описывает контракт NovaRenderPolicy.
 */
export interface NovaRenderPolicy {
  group: NovaRenderPolicyGroup
  cache: NovaRenderPolicyCache
  textQuality: NovaRenderPolicyTextQuality
  updateMode: NovaRenderPolicyUpdateMode
  layer: NovaRenderPolicyLayer
}

/**
 * Описывает тип NovaRenderPolicyInput.
 */
export type NovaRenderPolicyInput = Partial<NovaRenderPolicy>

/**
 * Описывает контракт NovaRendererBatchingConfig.
 */
export interface NovaRendererBatchingConfig {
  maxBatchSize: number
  semanticScopes: 'off' | 'safe' | 'manual'
  maxDrawCallsWarning: number
  plainRectStream: boolean
  roundedRectStream: boolean
  fullUploadDirtyRatio: number
}

/**
 * Описывает контракт NovaRendererTextConfig.
 */
export interface NovaRendererTextConfig {
  quality: 'performance' | 'balanced' | 'quality'
  mode: 'auto' | 'run-atlas' | 'glyph-atlas' | 'msdf'
  maxAtlasMemoryMB: number
  zoomBuckets: Array<number>
  dynamicBuckets: boolean
  prewarmAdjacentBuckets: boolean
  rasterBudgetMs: number
  bucketThrottleMs: number
  visibleOnlyRaster: boolean
  fallbackPreviousScale: boolean
  maxRasterScale: number
}

/**
 * Описывает контракт NovaRendererCacheConfig.
 */
export interface NovaRendererCacheConfig {
  maxTextureMemoryMB: number
  maxTextAtlasMemoryMB: number
  maxGlyphAtlasMemoryMB: number
  groupCache: 'auto' | 'off' | 'aggressive'
}

/**
 * Описывает контракт NovaRendererDiagnosticsConfig.
 */
export interface NovaRendererDiagnosticsConfig {
  showBatches: boolean
  showDirtyRegions: boolean
  showAtlas: boolean
}

/**
 * Описывает контракт NovaRendererConfig.
 */
export interface NovaRendererConfig {
  batching: NovaRendererBatchingConfig
  text: NovaRendererTextConfig
  cache: NovaRendererCacheConfig
  diagnostics: NovaRendererDiagnosticsConfig
}

/**
 * Описывает тип NovaRendererConfigInput.
 */
export type NovaRendererConfigInput = {
  batching?: Partial<NovaRendererBatchingConfig>
  text?: Partial<NovaRendererTextConfig>
  cache?: Partial<NovaRendererCacheConfig>
  diagnostics?: Partial<NovaRendererDiagnosticsConfig>
}

/**
 * Описывает контракт NovaRenderDirtyFlags.
 */
export interface NovaRenderDirtyFlags {
  transform: boolean
  layout: boolean
  paint: boolean
  children: boolean
  resource: boolean
  cache: boolean
  visibility: boolean
}

/**
 * Описывает контракт NovaRenderVersions.
 */
export interface NovaRenderVersions {
  transform: number
  layout: number
  paint: number
  children: number
  resource: number
  cache: number
  visibility: number
}

/**
 * Описывает контракт NovaRenderViewport.
 */
export interface NovaRenderViewport {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

/**
 * Описывает контракт NovaRenderClip.
 */
export interface NovaRenderClip {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Описывает контракт NovaRenderCachePolicy.
 */
export interface NovaRenderCachePolicy {
  enabled: boolean
  mode: 'auto' | 'texture'
  reason?: string
}

/**
 * Описывает тип NovaRenderTargetKind.
 */
export type NovaRenderTargetKind = 'screen' | 'texture' | 'cache' | 'effect' | 'picking' | 'debug'

/**
 * Описывает контракт NovaRenderTarget.
 */
export interface NovaRenderTarget {
  id: NovaRenderTargetId
  kind: NovaRenderTargetKind
  width: number
  height: number
  dpr: number
  ownerGroupId?: NovaRenderGroupId
  textureId?: string
  framebufferId?: string
}

/**
 * Описывает тип NovaRenderItemKind.
 */
export type NovaRenderItemKind =
  | 'rect'
  | 'border'
  | 'line'
  | 'circle'
  | 'polygon'
  | 'text'
  | 'icon'
  | 'image'
  | 'texture'
  | 'cached-group'
  | 'particle-circle'
  | 'particle-sprite'
  | 'rect-batch'
  | 'stripe-batch'
  | 'icon-batch'
  | 'text-batch'
  | 'custom'

/**
 * Описывает контракт NovaRenderItem.
 */
export interface NovaRenderItem {
  id: NovaRenderItemId
  nodeId?: string
  groupId: NovaRenderGroupId
  layerId: NovaRenderLayerId
  kind: NovaRenderItemKind
  order: number
  batchKey: string
  schemaItem?: NovaSchemaItem<any>
  transform?: mat3
  clip?: NovaRenderClip | null
  bounds?: NovaBounds
  dirtyFlags?: Partial<NovaRenderDirtyFlags>
}

/**
 * Описывает тип NovaRenderStreamKind.
 */
export type NovaRenderStreamKind =
  | 'plain-rect'
  | 'rounded-rect'
  | 'motion-rect'
  | 'border'
  | 'line'
  | 'circle'
  | 'polygon'
  | 'texture-quad'
  | 'text-run'
  | 'icon'
  | 'cached-group'
  | 'particle-circle'
  | 'particle-sprite'
  | 'rect-batch'
  | 'stripe-batch'
  | 'icon-batch'
  | 'text-batch'

/**
 * Описывает тип NovaRenderSemanticLayer.
 */
export type NovaRenderSemanticLayer =
  | 'background'
  | 'border'
  | 'texture'
  | 'text'
  | 'selection'
  | 'overlay'
  | 'strict'

/**
 * Описывает контракт NovaRenderStreamSlot.
 */
export interface NovaRenderStreamSlot {
  itemId: NovaRenderItemId
  offset: number
  count: number
  order: number
  batchKey: string
  bounds?: NovaBounds
}

/**
 * Описывает контракт NovaRenderStream.
 */
export interface NovaRenderStream {
  id: NovaRenderStreamId
  groupId: NovaRenderGroupId
  kind: NovaRenderStreamKind
  strideFloats: number
  slotCapacity: number
  slotCount: number
  version: number
  slots: Array<NovaRenderStreamSlot>
}

/**
 * Описывает контракт NovaRenderBatch.
 */
export interface NovaRenderBatch {
  id: string
  groupId: NovaRenderGroupId
  streamId: NovaRenderStreamId
  streamKind: NovaRenderStreamKind
  semanticLayer: NovaRenderSemanticLayer
  batchKey: string
  startSlot: number
  slotCount: number
  orderStart: number
  orderEnd: number
}

/**
 * Описывает контракт NovaBatchPlan.
 */
export interface NovaBatchPlan {
  id: string
  groupId: NovaRenderGroupId
  semanticScope?: NovaSemanticScopeKind
  version: number
  batches: Array<NovaRenderBatch>
}

/**
 * Описывает контракт NovaRenderHandle.
 */
export interface NovaRenderHandle {
  id: NovaRenderHandleId
  nodeId: string
  itemId: NovaRenderItemId
  groupId: NovaRenderGroupId
  layerId: NovaRenderLayerId
  streamId: NovaRenderStreamId
  streamKind: NovaRenderStreamKind
  offset: number
  count: number
  slotOffset?: number
  slotCount?: number
  batchKey: string
  versions: NovaRenderVersions
  resourceKey?: string
  localBounds?: NovaBounds
}

/**
 * Описывает тип NovaRenderCommandType.
 */
export type NovaRenderCommandType =
  | 'clear'
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'clip'
  | 'clearClip'
  | 'drawItem'
  | 'drawSchemaBatch'
  | 'drawParticles'
  | 'drawRectBatch'
  | 'drawStripeBatch'
  | 'drawIconBatch'
  | 'drawTextBatch'
  | 'cursor'
  | 'beginGroup'
  | 'endGroup'

/**
 * Описывает контракт NovaRenderCommand.
 */
export interface NovaRenderCommand {
  id: string
  type: NovaRenderCommandType
  order: number
  nodeId?: string
  groupId?: NovaRenderGroupId
  layerId?: NovaRenderLayerId
  itemId?: NovaRenderItemId
  schemaItems?: Array<NovaSchemaItem<any>>
  schemaMode?: 'batched' | 'ordered'
  schemaSemanticScope?: NovaSemanticScopeKind
  schemaContentVersion?: number
  particleBatch?: NovaParticleBatch
  rectBatch?: NovaRectBatch
  stripeBatch?: NovaStripeRectBatch
  iconBatch?: NovaIconBatch
  textBatch?: NovaTextBatch
  transform?: mat3
  clip?: NovaRenderClip
  cursor?: string
}

/**
 * Описывает контракт NovaInstructionBuffer.
 */
export interface NovaInstructionBuffer {
  id: string
  version: number
  commands: Array<NovaRenderCommand>
  items: Array<NovaRenderItem>
  reused: boolean
}

/**
 * Описывает контракт NovaRenderGroup.
 */
export interface NovaRenderGroup {
  id: NovaRenderGroupId
  ownerNodeId?: string
  parentGroupId?: NovaRenderGroupId
  layerId: NovaRenderLayerId
  transform?: mat3
  opacity: number
  clip?: NovaRenderClip
  cachePolicy?: NovaRenderCachePolicy
  dirtyFlags: NovaRenderDirtyFlags
  versions: NovaRenderVersions
  instructionBuffer: NovaInstructionBuffer
  renderHandlesByNodeId?: Map<string, Array<NovaRenderHandle>>
  streams?: Map<NovaRenderStreamId, NovaRenderStream>
  batchPlan?: NovaBatchPlan
  chunkBounds?: NovaBounds
  semanticScope?: NovaSemanticScopeKind
  cacheTargetId?: NovaRenderTargetId
  visible?: boolean
  childGroupIds: Array<NovaRenderGroupId>
  bounds?: NovaBounds
  lastCompiledVersion: number
  lastRenderedVersion: number
}

/**
 * Описывает контракт NovaRenderLayer.
 */
export interface NovaRenderLayer {
  id: NovaRenderLayerId
  zIndex: number
  rootGroup: NovaRenderGroup
  targetId?: NovaRenderTargetId
}

/**
 * Описывает контракт NovaRenderResourceDelta.
 */
export interface NovaRenderResourceDelta {
  texturesCreated: number
  texturesUpdated: number
  texturesEvicted: number
  textRunsRasterized: number
  bytesUploaded: number
}

/**
 * Описывает контракт NovaRenderMetrics.
 */
export interface NovaRenderMetrics {
  compilerMs: number
  backendMs: number
  uploadMs: number
  drawMs: number
  drawCalls: number
  batches: number
  instances?: number
  uploadBytes?: number
  bufferDataCalls?: number
  bufferSubDataCalls?: number
  fullUploads?: number
  dirtyRangeCount?: number
  gpuBufferCapacityBytes?: number
  nodeRenderCalls?: number
  compiledGroups?: number
  reusedGroups?: number
  updatedHandles?: number
  dirtyStreamRanges?: number
  textRasterCount?: number
  textCacheHits?: number
  textCacheMisses?: number
  textRasterDeferred?: number
  textAtlasPages?: number
  effectiveTextRasterScale?: number
  visibleTextRuns?: number
  culledTextRuns?: number
  textureBatchFallbacks?: number
  textBucketChanges?: number
  textBudgetExhausted?: number
  visibleRectItems?: number
  culledRectItems?: number
  atlasUploads?: number
  uniformOnlyFrames?: number
  commands: number
  items: number
  groups: number
  textRasterMs: number
  atlasMemoryMB: number
  cachedTextureMemoryMB: number
}

/**
 * Описывает контракт NovaRenderFrame.
 */
export interface NovaRenderFrame {
  id: number
  surfaceId: string
  rendererType: RendererType
  viewport: NovaRenderViewport
  layers: Array<NovaRenderLayer>
  targets: Array<NovaRenderTarget>
  groups: Array<NovaRenderGroup>
  items: Array<NovaRenderItem>
  commands: Array<NovaRenderCommand>
  resourceDelta: NovaRenderResourceDelta
  metrics: NovaRenderMetrics
}

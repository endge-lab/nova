import type { mat3 } from 'gl-matrix'
import type {
  NovaBounds,
  NovaSemanticScopeKind,
  NovaSchemaItem,
  RendererType,
} from '@/domain/types/renderer-types'

export type NovaRenderLayerId = 'main' | 'overlay' | 'selection' | 'drag-preview' | 'debug' | string
export type NovaRenderTargetId = string
export type NovaRenderGroupId = string
export type NovaRenderItemId = string
export type NovaRenderHandleId = string
export type NovaRenderStreamId = string

export type NovaRenderPolicyGroup = 'auto' | 'always' | 'never'
export type NovaRenderPolicyCache = 'auto' | 'texture' | 'none'
export type NovaRenderPolicyTextQuality = 'auto' | 'crisp' | 'performance'
export type NovaRenderPolicyUpdateMode = 'static' | 'dynamic' | 'stream'
export type NovaRenderPolicyLayer = 'auto' | 'main' | 'overlay' | 'debug' | NovaRenderLayerId

export interface NovaRenderPolicy {
  group: NovaRenderPolicyGroup
  cache: NovaRenderPolicyCache
  textQuality: NovaRenderPolicyTextQuality
  updateMode: NovaRenderPolicyUpdateMode
  layer: NovaRenderPolicyLayer
}

export type NovaRenderPolicyInput = Partial<NovaRenderPolicy>

export interface NovaRendererBatchingConfig {
  maxBatchSize: number
  semanticScopes: 'off' | 'safe' | 'manual'
  maxDrawCallsWarning: number
  plainRectStream: boolean
  roundedRectStream: boolean
  fullUploadDirtyRatio: number
}

export interface NovaRendererTextConfig {
  quality: 'performance' | 'balanced' | 'quality'
  mode: 'auto' | 'run-atlas' | 'glyph-atlas' | 'msdf'
  maxAtlasMemoryMB: number
  zoomBuckets: number[]
  dynamicBuckets: boolean
  prewarmAdjacentBuckets: boolean
  rasterBudgetMs: number
}

export interface NovaRendererCacheConfig {
  maxTextureMemoryMB: number
  maxTextAtlasMemoryMB: number
  maxGlyphAtlasMemoryMB: number
  groupCache: 'auto' | 'off' | 'aggressive'
}

export interface NovaRendererDiagnosticsConfig {
  showBatches: boolean
  showDirtyRegions: boolean
  showAtlas: boolean
}

export interface NovaRendererConfig {
  batching: NovaRendererBatchingConfig
  text: NovaRendererTextConfig
  cache: NovaRendererCacheConfig
  diagnostics: NovaRendererDiagnosticsConfig
}

export type NovaRendererConfigInput = {
  batching?: Partial<NovaRendererBatchingConfig>
  text?: Partial<NovaRendererTextConfig>
  cache?: Partial<NovaRendererCacheConfig>
  diagnostics?: Partial<NovaRendererDiagnosticsConfig>
}

export interface NovaRenderDirtyFlags {
  transform: boolean
  layout: boolean
  paint: boolean
  children: boolean
  resource: boolean
  cache: boolean
  visibility: boolean
}

export interface NovaRenderVersions {
  transform: number
  layout: number
  paint: number
  children: number
  resource: number
  cache: number
  visibility: number
}

export interface NovaRenderViewport {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

export interface NovaRenderClip {
  x: number
  y: number
  width: number
  height: number
}

export interface NovaRenderCachePolicy {
  enabled: boolean
  mode: 'auto' | 'texture'
  reason?: string
}

export type NovaRenderTargetKind = 'screen' | 'texture' | 'cache' | 'effect' | 'picking' | 'debug'

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
  | 'custom'

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

export type NovaRenderStreamKind =
  | 'plain-rect'
  | 'rounded-rect'
  | 'border'
  | 'line'
  | 'circle'
  | 'polygon'
  | 'texture-quad'
  | 'text-run'
  | 'icon'
  | 'cached-group'

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
  batchKey: string
  versions: NovaRenderVersions
  resourceKey?: string
  localBounds?: NovaBounds
}

export type NovaRenderCommandType =
  | 'clear'
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'clip'
  | 'clearClip'
  | 'drawItem'
  | 'drawSchemaBatch'
  | 'cursor'
  | 'beginGroup'
  | 'endGroup'

export interface NovaRenderCommand {
  id: string
  type: NovaRenderCommandType
  order: number
  nodeId?: string
  groupId?: NovaRenderGroupId
  layerId?: NovaRenderLayerId
  itemId?: NovaRenderItemId
  schemaItems?: NovaSchemaItem<any>[]
  schemaMode?: 'batched' | 'ordered'
  schemaSemanticScope?: NovaSemanticScopeKind
  schemaContentVersion?: number
  transform?: mat3
  clip?: NovaRenderClip
  cursor?: 'default' | 'pointer' | 'col-resize' | 'row-resize'
}

export interface NovaInstructionBuffer {
  id: string
  version: number
  commands: NovaRenderCommand[]
  items: NovaRenderItem[]
  reused: boolean
}

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
  renderHandlesByNodeId?: Map<string, NovaRenderHandle[]>
  childGroupIds: NovaRenderGroupId[]
  bounds?: NovaBounds
  lastCompiledVersion: number
  lastRenderedVersion: number
}

export interface NovaRenderLayer {
  id: NovaRenderLayerId
  zIndex: number
  rootGroup: NovaRenderGroup
  targetId?: NovaRenderTargetId
}

export interface NovaRenderResourceDelta {
  texturesCreated: number
  texturesUpdated: number
  texturesEvicted: number
  textRunsRasterized: number
  bytesUploaded: number
}

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
  commands: number
  items: number
  groups: number
  textRasterMs: number
  atlasMemoryMB: number
  cachedTextureMemoryMB: number
}

export interface NovaRenderFrame {
  id: number
  surfaceId: string
  rendererType: RendererType
  viewport: NovaRenderViewport
  layers: NovaRenderLayer[]
  targets: NovaRenderTarget[]
  groups: NovaRenderGroup[]
  items: NovaRenderItem[]
  commands: NovaRenderCommand[]
  resourceDelta: NovaRenderResourceDelta
  metrics: NovaRenderMetrics
}

import { mat3 } from 'gl-matrix'
import type {
  NovaRenderClip,
  NovaRenderFrame,
  NovaRenderItem,
  NovaRenderMetrics,
  NovaRendererTextConfig,
} from '@/domain/types/rendering/index'
import type {
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaParticleBatch,
  NovaPolygon,
  NovaRect,
  NovaRectBatch,
  NovaSchemaItem,
  NovaSemanticScopeKind,
  NovaText,
} from '@/domain/types/renderer.types'
import { NovaGraphics } from '@/model/platform/NovaGraphics'
import type { NovaWebGLDevice } from '@/model/render/backends/webgl/NovaWebGLDevice'
import { NovaGpuBufferArena } from '@/model/render/backends/webgl/NovaGpuBufferArena'
import { NovaWebGLProgram } from '@/model/render/backends/webgl/NovaWebGLProgram'
import {
  DEFAULT_NOVA_RENDERER_CONFIG,
  resolveNovaTextRasterScale,
} from '@/model/render/policy/NovaRenderPolicy'
import type { NovaParsedColor } from '@/model/render/schema/NovaColorParser'
import {
  compileNovaBorderStyle,
  compileNovaCircleStyle,
  compileNovaLineStyle,
  compileNovaPolygonStyle,
  compileNovaRectStyle,
  compileNovaTextStyle,
  type NovaCompiledTextStyle,
} from '@/model/render/schema/NovaStyleCompiler'

const FLOAT_BYTES = 4
const RECT_STRIDE = 21
const SOLID_STRIDE = 9
const TEXTURE_STRIDE = 8
const PARTICLE_POSITION_STRIDE = 2
const PARTICLE_CIRCLE_STATIC_STRIDE = 10
const PARTICLE_SPRITE_STATIC_STRIDE = 2
const RECT_BATCH_GEOMETRY_STRIDE = 4
const RECT_BATCH_STATIC_STRIDE = 5
const FULL_UPLOAD_DIRTY_RATIO = 0.6
const TEXT_ATLAS_PAGE_SIZE = 2048

/**
 * Описывает контракт RenderStats.
 */
interface RenderStats {
  drawCalls: number
  batches: number
  instances: number
  uploadBytes: number
  uploadMs: number
  bufferDataCalls: number
  bufferSubDataCalls: number
  fullUploads: number
  dirtyRangeCount: number
  updatedHandles: number
  dirtyStreamRanges: number
  gpuBufferCapacityBytes: number
  textRasterMs: number
  textRasterCount: number
  textCacheHits: number
  textCacheMisses: number
  textRasterDeferred: number
  textAtlasPages: number
  effectiveTextRasterScale: number
  visibleTextRuns: number
  culledTextRuns: number
  textureBatchFallbacks: number
  textBucketChanges: number
  textBudgetExhausted: number
  visibleRectItems: number
  culledRectItems: number
  atlasUploads: number
  atlasMemoryMB: number
}

/**
 * Описывает metadata для shader-driven animation на schema item.
 */
interface NovaShaderAnimationMeta {
  type?: 'pulse-color'
  phase?: number
  speed?: number
  amplitude?: number
}

/**
 * Описывает metadata для shader-driven movement на schema item.
 */
interface NovaShaderMotionMeta {
  type?: 'wrap-x' | 'slayline'
  speed?: number
  wrapWidth?: number
}

/**
 * Описывает metadata, которую renderer читает без расширения публичного NovaSchema.
 */
interface NovaShaderRenderMeta {
  animation?: NovaShaderAnimationMeta
  motion?: NovaShaderMotionMeta
}

/**
 * Описывает нормализованные shader animation attributes.
 */
interface ResolvedShaderAnimation {
  phase: number
  speed: number
  amplitude: number
}

/**
 * Описывает нормализованные shader movement attributes.
 */
interface ResolvedShaderMotion {
  speed: number
  wrapWidth: number
}

const EMPTY_SHADER_ANIMATION: ResolvedShaderAnimation = Object.freeze({
  phase: 0,
  speed: 0,
  amplitude: 0,
})

const EMPTY_SHADER_MOTION: ResolvedShaderMotion = Object.freeze({
  speed: 0,
  wrapWidth: 0,
})

/**
 * Описывает контракт TextureEntry.
 */
interface TextureEntry {
  key: string
  texture: WebGLTexture
  width: number
  height: number
  bytes: number
  lastUsed: number
}

/**
 * Описывает страницу atlas для rasterized text runs.
 */
interface TextAtlasPage {
  key: string
  texture: TextureEntry
  width: number
  height: number
  cursorX: number
  cursorY: number
  rowHeight: number
  entries: Set<string>
  lastUsed: number
}

/**
 * Описывает entry rasterized text run внутри atlas page.
 */
interface TextAtlasEntry {
  key: string
  baseKey: string
  page: TextAtlasPage
  x: number
  y: number
  width: number
  height: number
  scale: number
  bytes: number
  lastUsed: number
}

/**
 * Описывает контракт RasterizedText.
 */
interface RasterizedText {
  canvas: HTMLCanvasElement
  width: number
  height: number
  scale: number
}

/**
 * Описывает контракт RectBatchCache.
 */
interface RectBatchCache {
  data: Float32Array
  instances: number
  itemOffsets: Array<number>
  signatures: Array<string>
  contentVersion?: number
  visibilityKey?: string
}

/**
 * Описывает контракт TextureBatchCache.
 */
interface TextureBatchCache {
  data: Float32Array
  instances: number
  itemOffsets: Array<number>
  signatures: Array<string>
  texture: TextureEntry | null
  upload: WebGLUploadState
  contentVersion?: number
  rasterScale?: number
  visibilityKey?: string
  buffer?: WebGLBuffer
  vao?: WebGLVertexArrayObject
}

/**
 * Описывает culled texture batch item.
 */
interface CulledTextureBatchItem {
  culled: true
  signature: string
}

/**
 * Описывает контракт NonOverlapLayeredBatchCache.
 */
interface NonOverlapLayeredBatchCache {
  rects: Array<NovaSchemaItem<any>>
  icons: Array<NovaSchemaItem<any>>
  texts: Array<NovaSchemaItem<any>>
  rectIndexBySourceIndex: Array<number | undefined>
  iconIndexBySourceIndex: Array<number | undefined>
  textIndexBySourceIndex: Array<number | undefined>
  sourceKinds: Array<'rect' | 'icon' | 'text'>
}

/**
 * Описывает schema batch array with retained dirty metadata.
 */
interface SchemaBatchItems extends Array<NovaSchemaItem<any>> {
  dirtyIndices?: ReadonlyArray<number>
}

/**
 * Описывает контракт WebGLUploadState.
 */
interface WebGLUploadState {
  capacityBytes: number
  lastData?: Float32Array
  arena: NovaGpuBufferArena
}

/**
 * Описывает cache для instanced circle particle batch.
 */
interface ParticleCircleBatchCache {
  positionData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  positionUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  positionBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает cache для instanced sprite particle batch.
 */
interface ParticleSpriteBatchCache {
  positionData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  texture?: TextureEntry
  positionUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  positionBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает cache для instanced rect batch.
 */
interface RectStreamBatchCache {
  geometryData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  geometryUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  geometryBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает контракт FloatDirtyRange.
 */
interface FloatDirtyRange {
  start: number
  end: number
}

/**
 * Создает web glupload state.
 */
function createWebGLUploadState(): WebGLUploadState {
  return {
    capacityBytes: 0,
    arena: new NovaGpuBufferArena(FULL_UPLOAD_DIRTY_RATIO),
  }
}

/**
 * Описывает контракт RectBatchUpdate.
 */
interface RectBatchUpdate {
  dirtyRanges: Array<FloatDirtyRange>
  changedItems: number
}

/**
 * Описывает контракт TextureBatchUpdate.
 */
interface TextureBatchUpdate {
  dirtyRanges: Array<FloatDirtyRange>
  changedItems: number
}

/**
 * Описывает контракт TextureBatchItem.
 */
interface TextureBatchItem {
  texture: TextureEntry
  signature: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  u0: number
  v0: number
  u1: number
  v1: number
}

/**
 * Описывает drawable item для text atlas.
 */
interface TextAtlasDrawableItem {
  key: string
  texture: TextureEntry
  u0: number
  v0: number
  u1: number
  v1: number
}

/**
 * Преобразует Nova render frame в WebGL draw calls и GPU uploads.
 */
export class NovaWebGLFrameRenderer {
  private readonly _gl: WebGL2RenderingContext
  private readonly _roundedProgram: NovaWebGLProgram
  private readonly _solidProgram: NovaWebGLProgram
  private readonly _textureProgram: NovaWebGLProgram
  private readonly _particleCircleProgram: NovaWebGLProgram
  private readonly _particleSpriteProgram: NovaWebGLProgram
  private readonly _rectBatchProgram: NovaWebGLProgram
  private readonly _roundedBuffer: WebGLBuffer
  private readonly _solidBuffer: WebGLBuffer
  private readonly _textureBuffer: WebGLBuffer
  private readonly _particleQuadBuffer: WebGLBuffer
  private readonly _roundedVao: WebGLVertexArrayObject
  private readonly _solidVao: WebGLVertexArrayObject
  private readonly _textureVao: WebGLVertexArrayObject
  private readonly _measureCanvas = document.createElement('canvas')
  private readonly _textRasterCanvas = document.createElement('canvas')
  private readonly _textures = new Map<string, TextureEntry>()
  private readonly _textAtlasPages: Array<TextAtlasPage> = []
  private readonly _textAtlasEntries = new Map<string, TextAtlasEntry>()
  private readonly _textFallbackKeys = new Map<string, string>()
  private readonly _sourceTextureKeys = new WeakMap<object, string>()
  private readonly _plainRectBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, RectBatchCache>()
  private readonly _rectBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, RectBatchCache>()
  private readonly _textureBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, TextureBatchCache>()
  private readonly _semanticBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, NonOverlapLayeredBatchCache>()
  private readonly _particleCircleBatchCache = new WeakMap<NovaParticleBatch, ParticleCircleBatchCache>()
  private readonly _particleSpriteBatchCache = new WeakMap<NovaParticleBatch, ParticleSpriteBatchCache>()
  private readonly _rectStreamBatchCache = new WeakMap<NovaRectBatch, RectStreamBatchCache>()
  private readonly _ownedTextureBatchCaches = new Set<TextureBatchCache>()
  private readonly _ownedParticleCircleBatchCaches = new Set<ParticleCircleBatchCache>()
  private readonly _ownedParticleSpriteBatchCaches = new Set<ParticleSpriteBatchCache>()
  private readonly _ownedRectStreamBatchCaches = new Set<RectStreamBatchCache>()
  private readonly _roundedUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _solidUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _textureUpload: WebGLUploadState = createWebGLUploadState()

  private _rectData: Array<number> = []
  private _rectCachedData: Float32Array | null = null
  private _rectCachedDirtyRanges: Array<FloatDirtyRange> | null = null
  private _solidData: Array<number> = []
  private _solidCachedData: Float32Array | null = null
  private _solidCachedDirtyRanges: Array<FloatDirtyRange> | null = null
  private _textureData: Array<number> = []
  private _textureBatch: TextureEntry | null = null
  private _textureCachedData: Float32Array | null = null
  private _textureCachedDirtyRanges: Array<FloatDirtyRange> | null = null
  private _textureCachedBatch: TextureBatchCache | null = null
  private _roundedTransform = mat3.create()
  private _solidTransform = mat3.create()
  private _textureTransform = mat3.create()
  private _time = 0
  private _viewportWidth = 1
  private _viewportHeight = 1
  private _effectiveTextRasterScale = 0
  private _lastTextBucketSwitchAt = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _device: NovaWebGLDevice,
    private readonly _textConfig: NovaRendererTextConfig = DEFAULT_NOVA_RENDERER_CONFIG.text,
  ) {
    this._gl = _device.gl
    this._roundedProgram = NovaWebGLProgram.create(this._gl, ROUNDED_RECT_VERTEX_SHADER, ROUNDED_RECT_FRAGMENT_SHADER)
    this._solidProgram = NovaWebGLProgram.create(this._gl, SOLID_VERTEX_SHADER, SOLID_FRAGMENT_SHADER)
    this._textureProgram = NovaWebGLProgram.create(this._gl, TEXTURE_VERTEX_SHADER, TEXTURE_FRAGMENT_SHADER)
    this._particleCircleProgram = NovaWebGLProgram.create(this._gl, PARTICLE_CIRCLE_VERTEX_SHADER, PARTICLE_CIRCLE_FRAGMENT_SHADER)
    this._particleSpriteProgram = NovaWebGLProgram.create(this._gl, PARTICLE_SPRITE_VERTEX_SHADER, PARTICLE_SPRITE_FRAGMENT_SHADER)
    this._rectBatchProgram = NovaWebGLProgram.create(this._gl, RECT_BATCH_VERTEX_SHADER, RECT_BATCH_FRAGMENT_SHADER)
    this._roundedBuffer = this.createBuffer()
    this._solidBuffer = this.createBuffer()
    this._textureBuffer = this.createBuffer()
    this._particleQuadBuffer = this.createBuffer()
    this.initializeParticleQuadBuffer()
    this._roundedVao = this.createRoundedVao()
    this._solidVao = this.createSolidVao()
    this._textureVao = this.createTextureVao()
  }

  /**
   * Выполняет render-операцию .
   */
  render(frame: NovaRenderFrame): NovaRenderMetrics {
    const startedAt = performance.now()
    const stats: RenderStats = {
      drawCalls: 0,
      batches: 0,
      instances: 0,
      uploadBytes: 0,
      uploadMs: 0,
      bufferDataCalls: 0,
      bufferSubDataCalls: 0,
      fullUploads: 0,
      dirtyRangeCount: 0,
      updatedHandles: 0,
      dirtyStreamRanges: 0,
      gpuBufferCapacityBytes: 0,
      textRasterMs: 0,
      textRasterCount: 0,
      textCacheHits: 0,
      textCacheMisses: 0,
      textRasterDeferred: 0,
      textAtlasPages: this._textAtlasPages.length,
      effectiveTextRasterScale: 0,
      visibleTextRuns: 0,
      culledTextRuns: 0,
      textureBatchFallbacks: 0,
      textBucketChanges: 0,
      textBudgetExhausted: 0,
      visibleRectItems: 0,
      culledRectItems: 0,
      atlasUploads: 0,
      atlasMemoryMB: this.textureMemoryMB(),
    }
    const itemMap = frame.items.length > 0 ? new Map(frame.items.map(item => [item.id, item])) : null
    const identity = mat3.create()
    let currentTransform = identity
    const transformStack: Array<mat3> = []
    const clipStack: Array<NovaRenderClip> = []

    this._time += 1
    this._viewportWidth = Math.max(1, frame.viewport.width)
    this._viewportHeight = Math.max(1, frame.viewport.height)
    this._device.resize()
    this.setScissor(null, currentTransform)

    const pushClip = (clip: NovaRenderClip | null | undefined, transform: mat3): void => {
      if (!clip) return
      this.flush(stats)
      clipStack.push(clip)
      this.setScissor(clip, transform)
    }

    const popClip = (transform: mat3): void => {
      if (clipStack.length === 0) return
      this.flush(stats)
      clipStack.pop()
      this.setScissor(clipStack[clipStack.length - 1] ?? null, transform)
    }

    const drawSchemaItem = (item: NovaSchemaItem<any>, transform: mat3): void => {
      if (item.active === false) return
      if (item.clip !== undefined && item.clip !== true) pushClip(item.clip, transform)
      this.drawPrimitive(item, transform, stats)
      if (item.clip !== undefined && item.clip !== true) popClip(transform)
    }

    for (const command of frame.commands) {
      switch (command.type) {
        case 'clear':
          this.flush(stats)
          this._device.clear()
          break
        case 'save':
          transformStack.push(mat3.clone(currentTransform))
          break
        case 'restore':
          currentTransform = transformStack.pop() ?? identity
          break
        case 'setTransform':
          currentTransform = command.transform ? (command.transform as mat3) : identity
          break
        case 'clip':
          pushClip(command.clip, currentTransform)
          break
        case 'clearClip':
          popClip(currentTransform)
          break
        case 'drawItem': {
          const item = command.itemId ? itemMap?.get(command.itemId) : undefined
          if (item?.schemaItem) this.drawRenderItem(item, stats)
          break
        }
        case 'drawSchemaBatch':
          if (!this.drawSchemaBatch(
            command.schemaItems ?? [],
            currentTransform,
            stats,
            command.schemaSemanticScope,
            this.resolveSchemaContentVersion(command.schemaItems, command.schemaContentVersion),
          )) {
            for (const schemaItem of command.schemaItems ?? []) {
              drawSchemaItem(schemaItem, currentTransform)
            }
          }
          break
        case 'drawParticles':
          if (command.particleBatch) this.drawParticleBatch(command.particleBatch, currentTransform, stats)
          break
        case 'drawRectBatch':
          if (command.rectBatch) this.drawRectBatch(command.rectBatch, currentTransform, stats)
          break
        case 'cursor':
        case 'beginGroup':
        case 'endGroup':
        default:
          break
      }
    }

    this.flush(stats)
    this.setScissor(null, identity)
    const backendMs = performance.now() - startedAt

    return {
      ...frame.metrics,
      backendMs,
      drawMs: Math.max(0, backendMs - stats.uploadMs - stats.textRasterMs),
      drawCalls: stats.drawCalls,
      batches: stats.batches,
      instances: stats.instances,
      uploadBytes: stats.uploadBytes,
      bufferDataCalls: stats.bufferDataCalls,
      bufferSubDataCalls: stats.bufferSubDataCalls,
      fullUploads: stats.fullUploads,
      dirtyRangeCount: stats.dirtyRangeCount,
      gpuBufferCapacityBytes: stats.gpuBufferCapacityBytes,
      updatedHandles: stats.updatedHandles,
      dirtyStreamRanges: stats.dirtyStreamRanges,
      uploadMs: stats.uploadMs,
      textRasterMs: stats.textRasterMs,
      textRasterCount: stats.textRasterCount,
      textCacheHits: stats.textCacheHits,
      textCacheMisses: stats.textCacheMisses,
      textRasterDeferred: stats.textRasterDeferred,
      textAtlasPages: this._textAtlasPages.length,
      effectiveTextRasterScale: stats.effectiveTextRasterScale,
      visibleTextRuns: stats.visibleTextRuns,
      culledTextRuns: stats.culledTextRuns,
      textureBatchFallbacks: stats.textureBatchFallbacks,
      textBucketChanges: stats.textBucketChanges,
      textBudgetExhausted: stats.textBudgetExhausted,
      visibleRectItems: stats.visibleRectItems,
      culledRectItems: stats.culledRectItems,
      atlasUploads: stats.atlasUploads,
      uniformOnlyFrames: stats.uploadBytes === 0 && stats.textRasterMs === 0 ? 1 : 0,
      atlasMemoryMB: this.textureMemoryMB(),
      cachedTextureMemoryMB: this.textureMemoryMB(),
    }
  }

  /**
   * Выполняет внутреннюю операцию measure text.
   */
  measureText(params: NovaText): { width: number; height: number } {
    const context = this._measureCanvas.getContext('2d')
    const style = compileNovaTextStyle(params)
    if (!context) {
      return {
        width: params.text.length * style.fontSize * 0.6,
        height: style.lineHeight,
      }
    }

    context.font = style.font
    return {
      width: context.measureText(params.text).width,
      height: style.lineHeight,
    }
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    for (const texture of this._textures.values()) this._gl.deleteTexture(texture.texture)
    this._textures.clear()
    this.destroyTextAtlas()
    for (const cache of this._ownedTextureBatchCaches) {
      if (cache.buffer) this._gl.deleteBuffer(cache.buffer)
      if (cache.vao) this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedTextureBatchCaches.clear()
    for (const cache of this._ownedParticleCircleBatchCaches) {
      this._gl.deleteBuffer(cache.positionBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedParticleCircleBatchCaches.clear()
    for (const cache of this._ownedParticleSpriteBatchCaches) {
      this._gl.deleteBuffer(cache.positionBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedParticleSpriteBatchCaches.clear()
    for (const cache of this._ownedRectStreamBatchCaches) {
      this._gl.deleteBuffer(cache.geometryBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedRectStreamBatchCaches.clear()
    this._gl.deleteBuffer(this._roundedBuffer)
    this._gl.deleteBuffer(this._solidBuffer)
    this._gl.deleteBuffer(this._textureBuffer)
    this._gl.deleteBuffer(this._particleQuadBuffer)
    this._gl.deleteVertexArray(this._roundedVao)
    this._gl.deleteVertexArray(this._solidVao)
    this._gl.deleteVertexArray(this._textureVao)
    this._roundedProgram.destroy()
    this._solidProgram.destroy()
    this._textureProgram.destroy()
    this._particleCircleProgram.destroy()
    this._particleSpriteProgram.destroy()
    this._rectBatchProgram.destroy()
  }

  /**
   * Выполняет внутреннюю операцию draw render item.
   */
  private drawRenderItem(item: NovaRenderItem, stats: RenderStats): void {
    if (!item.schemaItem) return
    this.drawPrimitive(item.schemaItem, item.transform ?? mat3.create(), stats)
  }

  /**
   * Вычисляет schema content version.
   */
  private resolveSchemaContentVersion(items: Array<NovaSchemaItem<any>> | undefined, fallback: number | undefined): number | undefined {
    return (items as { contentVersion?: number } | undefined)?.contentVersion ?? fallback
  }

  /**
   * Возвращает retained dirty indices for schema batch.
   */
  private resolveSchemaDirtyIndices(items: Array<NovaSchemaItem<any>>): ReadonlyArray<number> | undefined {
    const dirtyIndices = (items as SchemaBatchItems).dirtyIndices
    if (!dirtyIndices) return undefined
    if (dirtyIndices.length === 0) return []

    const normalized: Array<number> = []
    const seen = new Set<number>()
    for (const index of dirtyIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) continue
      seen.add(index)
      normalized.push(index)
    }

    return normalized
  }

  /**
   * Переносит dirty indices исходного semantic batch на дочерний layer batch.
   */
  private applyLayerDirtyIndices(
    sourceItems: Array<NovaSchemaItem<any>>,
    targetItems: Array<NovaSchemaItem<any>>,
    targetIndexBySourceIndex: Array<number | undefined>,
  ): void {
    const sourceDirtyIndices = this.resolveSchemaDirtyIndices(sourceItems)
    const target = targetItems as SchemaBatchItems

    if (!sourceDirtyIndices) {
      target.dirtyIndices = undefined
      return
    }

    const dirtyIndices: Array<number> = []
    const seen = new Set<number>()
    for (const sourceIndex of sourceDirtyIndices) {
      const targetIndex = targetIndexBySourceIndex[sourceIndex]
      if (targetIndex === undefined || seen.has(targetIndex)) continue
      seen.add(targetIndex)
      dirtyIndices.push(targetIndex)
    }

    target.dirtyIndices = dirtyIndices
  }

  /**
   * Выполняет внутреннюю операцию draw schema batch.
   */
  private drawSchemaBatch(
    items: Array<NovaSchemaItem<any>>,
    transform: mat3,
    stats: RenderStats,
    semanticScope?: NovaSemanticScopeKind,
    contentVersion?: number,
  ): boolean {
    const dirtyIndices = this.resolveSchemaDirtyIndices(items)

    if (semanticScope === 'non-overlap-layered' && this.drawNonOverlapLayeredSchemaBatch(items, transform, stats, contentVersion)) {
      return true
    }

    if (items.length === 0 || !items.every(item => item.type === 'rect' && item.active !== false && (item.clip === undefined || item.clip === true))) {
      return false
    }

    if (items.every(item => this.isPlainRect(item as NovaRect))) {
      return this.drawPlainRectSchemaBatch(items, transform, stats, contentVersion)
    }

    let batch = this._rectBatchCache.get(items)
    let dirtyRanges: Array<FloatDirtyRange> | null = null
    let changedItems = 0
    const visibilityKey = this.resolveBatchVisibilityKey(items, transform)
    if (!batch) {
      const nextBatch = this.buildRectBatch(items, transform, stats)
      if (!nextBatch) return false
      nextBatch.contentVersion = contentVersion
      nextBatch.visibilityKey = visibilityKey
      batch = nextBatch
      this._rectBatchCache.set(items, nextBatch)
    } else if (batch.visibilityKey !== visibilityKey) {
      const nextBatch = this.buildRectBatch(items, transform, stats)
      if (!nextBatch) return false
      nextBatch.contentVersion = contentVersion
      nextBatch.visibilityKey = visibilityKey
      batch = nextBatch
      this._rectBatchCache.set(items, nextBatch)
    } else if (contentVersion === undefined || batch.contentVersion !== contentVersion) {
      const update = this.updateRectBatch(items, batch, dirtyIndices)
      if (!update) {
        const nextBatch = this.buildRectBatch(items, transform, stats)
        if (!nextBatch) return false
        nextBatch.contentVersion = contentVersion
        nextBatch.visibilityKey = visibilityKey
        batch = nextBatch
        this._rectBatchCache.set(items, nextBatch)
      } else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
      }
    }

    if (batch.data.length === 0) return true
    this.flushTexture(stats)
    this.flushSolid(stats)
    this.prepareRoundedTransform(transform, stats)
    if (this._rectData.length > 0 || this._rectCachedData) this.flushRounded(stats)
    this._rectCachedData = batch.data
    this._rectCachedDirtyRanges = dirtyRanges
    stats.instances += batch.instances
    if (dirtyRanges?.length) {
      stats.updatedHandles += changedItems
      stats.dirtyStreamRanges += dirtyRanges.length
    }
    return true
  }

  /**
   * Выполняет внутреннюю операцию draw plain rect schema batch.
   */
  private drawPlainRectSchemaBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    let batch = this._plainRectBatchCache.get(items)
    let dirtyRanges: Array<FloatDirtyRange> | null = null
    let changedItems = 0
    const dirtyIndices = this.resolveSchemaDirtyIndices(items)
    const visibilityKey = this.resolveBatchVisibilityKey(items, transform)

    if (!batch) {
      batch = this.buildPlainRectBatch(items, transform, stats)
      batch.contentVersion = contentVersion
      batch.visibilityKey = visibilityKey
      this._plainRectBatchCache.set(items, batch)
    } else if (batch.visibilityKey !== visibilityKey) {
      batch = this.buildPlainRectBatch(items, transform, stats)
      batch.contentVersion = contentVersion
      batch.visibilityKey = visibilityKey
      this._plainRectBatchCache.set(items, batch)
    } else if (contentVersion === undefined || batch.contentVersion !== contentVersion) {
      const update = this.updatePlainRectBatch(items, batch, dirtyIndices)
      if (!update) {
        batch = this.buildPlainRectBatch(items, transform, stats)
        batch.contentVersion = contentVersion
        batch.visibilityKey = visibilityKey
        this._plainRectBatchCache.set(items, batch)
      } else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
      }
    }

    if (batch.data.length === 0) return true

    this.flushTexture(stats)
    this.flushRounded(stats)
    this.prepareSolidTransform(transform, stats)
    if (this._solidData.length > 0 || this._solidCachedData) this.flushSolid(stats)
    this._solidCachedData = batch.data
    this._solidCachedDirtyRanges = dirtyRanges
    stats.instances += batch.instances
    if (dirtyRanges?.length) {
      stats.updatedHandles += changedItems
      stats.dirtyStreamRanges += dirtyRanges.length
    }
    return true
  }

  /**
   * Выполняет внутреннюю операцию draw non overlap layered schema batch.
   */
  private drawNonOverlapLayeredSchemaBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    if (items.length === 0) return true

    const batch = this.resolveNonOverlapLayeredBatch(items)
    if (!batch) return false

    this.applyLayerDirtyIndices(items, batch.rects, batch.rectIndexBySourceIndex)
    if (batch.rects.length > 0 && !this.drawSchemaBatch(batch.rects, transform, stats, undefined, contentVersion)) return false

    this.applyLayerDirtyIndices(items, batch.icons, batch.iconIndexBySourceIndex)
    if (batch.icons.length > 0 && !this.drawTextureSchemaBatch(batch.icons, transform, stats, contentVersion)) return false

    this.applyLayerDirtyIndices(items, batch.texts, batch.textIndexBySourceIndex)
    if (batch.texts.length > 0 && !this.drawTextureSchemaBatch(batch.texts, transform, stats, contentVersion)) {
      stats.textureBatchFallbacks += 1
      for (const text of batch.texts) {
        this.drawPrimitive(text, transform, stats)
      }
    }

    return true
  }

  /**
   * Вычисляет non overlap layered batch.
   */
  private resolveNonOverlapLayeredBatch(items: Array<NovaSchemaItem<any>>): NonOverlapLayeredBatchCache | null {
    const cached = this._semanticBatchCache.get(items)
    if (cached && this.refreshNonOverlapLayeredBatch(cached, items)) return cached

    const rects: Array<NovaSchemaItem<any>> = []
    const icons: Array<NovaSchemaItem<any>> = []
    const texts: Array<NovaSchemaItem<any>> = []
    const rectIndexBySourceIndex: Array<number | undefined> = []
    const iconIndexBySourceIndex: Array<number | undefined> = []
    const textIndexBySourceIndex: Array<number | undefined> = []
    const sourceKinds: Array<'rect' | 'icon' | 'text'> = []

    for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
      const item = items[sourceIndex]
      if (item.active === false) continue
      if (item.clip !== undefined && item.clip !== true) return null

      if (item.type === 'rect') {
        rectIndexBySourceIndex[sourceIndex] = rects.length
        sourceKinds[sourceIndex] = 'rect'
        rects.push(item)
        continue
      }

      if (item.type === 'icon') {
        iconIndexBySourceIndex[sourceIndex] = icons.length
        sourceKinds[sourceIndex] = 'icon'
        icons.push(item)
        continue
      }

      if (item.type === 'text') {
        textIndexBySourceIndex[sourceIndex] = texts.length
        sourceKinds[sourceIndex] = 'text'
        texts.push(item)
        continue
      }

      return null
    }

    const batch = {
      rects,
      icons,
      texts,
      rectIndexBySourceIndex,
      iconIndexBySourceIndex,
      textIndexBySourceIndex,
      sourceKinds,
    }
    this._semanticBatchCache.set(items, batch)
    return batch
  }

  /**
   * Обновляет cached semantic child arrays свежими item references из mutable source schema.
   */
  private refreshNonOverlapLayeredBatch(
    batch: NonOverlapLayeredBatchCache,
    items: Array<NovaSchemaItem<any>>,
  ): boolean {
    if (batch.sourceKinds.length !== items.length) return false

    for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
      const item = items[sourceIndex]
      if (item.active === false || (item.clip !== undefined && item.clip !== true)) return false

      const kind = batch.sourceKinds[sourceIndex]
      if (item.type !== kind) return false

      if (kind === 'rect') {
        const targetIndex = batch.rectIndexBySourceIndex[sourceIndex]
        if (targetIndex === undefined) return false
        batch.rects[targetIndex] = item
        continue
      }

      if (kind === 'icon') {
        const targetIndex = batch.iconIndexBySourceIndex[sourceIndex]
        if (targetIndex === undefined) return false
        batch.icons[targetIndex] = item
        continue
      }

      const targetIndex = batch.textIndexBySourceIndex[sourceIndex]
      if (targetIndex === undefined) return false
      batch.texts[targetIndex] = item
    }

    return true
  }

  /**
   * Выполняет внутреннюю операцию build rect batch.
   */
  private buildRectBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats): RectBatchCache | null {
    const data: Array<number> = []
    const itemOffsets: Array<number> = new Array(items.length).fill(-1)
    const signatures: Array<string> = new Array(items.length).fill('')
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      signatures[index] = this.createRectSignature(rect)
      if (this.shouldCullGeometryItems() && !this.isRectVisible(transform, rect.x, rect.y, rect.width, rect.height)) {
        stats.culledRectItems += 1
        continue
      }
      stats.visibleRectItems += 1
      const background = rect.styles?.background
      if (background && typeof background !== 'string') return null
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0) continue
      if (style.fill.a <= 0 && (style.borderColor.a <= 0 || style.borderWidth <= 0)) continue

      itemOffsets[index] = data.length
      this.pushRoundedRectVertices(
        data,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        style.borderRadius,
        style.fill,
        style.opacity,
        style.borderColor,
        style.borderWidth,
        this.resolveShaderRenderMeta(rect),
      )
      instances += 1
    }

    return {
      data: new Float32Array(data),
      instances,
      itemOffsets,
      signatures,
    }
  }

  /**
   * Выполняет внутреннюю операцию build plain rect batch.
   */
  private buildPlainRectBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats): RectBatchCache {
    const data: Array<number> = []
    const itemOffsets: Array<number> = new Array(items.length).fill(-1)
    const signatures: Array<string> = new Array(items.length).fill('')
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      signatures[index] = this.createRectSignature(rect)
      if (this.shouldCullGeometryItems() && !this.isRectVisible(transform, rect.x, rect.y, rect.width, rect.height)) {
        stats.culledRectItems += 1
        continue
      }
      stats.visibleRectItems += 1
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0 || style.fill.a <= 0) continue

      itemOffsets[index] = data.length
      this.pushSolidRectVertices(data, rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, this.resolveShaderRenderMeta(rect))
      instances += 1
    }

    return {
      data: new Float32Array(data),
      instances,
      itemOffsets,
      signatures,
    }
  }

  /**
   * Обновляет rect batch.
   */
  private updateRectBatch(
    items: Array<NovaSchemaItem<any>>,
    batch: RectBatchCache,
    dirtyIndices?: ReadonlyArray<number>,
  ): RectBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) return null

    const dirtyRanges: Array<FloatDirtyRange> = []
    let changedItems = 0

    const indexCount = dirtyIndices?.length ?? items.length
    for (let dirtyIndex = 0; dirtyIndex < indexCount; dirtyIndex += 1) {
      const index = dirtyIndices ? dirtyIndices[dirtyIndex] : dirtyIndex
      const rect = items[index] as NovaRect
      const signature = this.createRectSignature(rect)
      if (signature === batch.signatures[index]) continue

      const offset = batch.itemOffsets[index]
      if (offset < 0) {
        batch.signatures[index] = signature
        continue
      }
      const background = rect.styles?.background
      if (background && typeof background !== 'string') return null
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0) return null
      if (style.fill.a <= 0 && (style.borderColor.a <= 0 || style.borderWidth <= 0)) return null

      this.writeRoundedRectVertices(
        batch.data,
        offset,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        style.borderRadius,
        style.fill,
        style.opacity,
        style.borderColor,
        style.borderWidth,
        this.resolveShaderRenderMeta(rect),
      )
      batch.signatures[index] = signature
      changedItems += 1
      dirtyRanges.push({ start: offset, end: offset + RECT_STRIDE * 6 })
    }

    return {
      dirtyRanges: mergeFloatDirtyRanges(dirtyRanges),
      changedItems,
    }
  }

  /**
   * Обновляет plain rect batch.
   */
  private updatePlainRectBatch(
    items: Array<NovaSchemaItem<any>>,
    batch: RectBatchCache,
    dirtyIndices?: ReadonlyArray<number>,
  ): RectBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) {
      return null
    }

    const dirtyRanges: Array<FloatDirtyRange> = []
    let changedItems = 0

    const indexCount = dirtyIndices?.length ?? items.length
    for (let dirtyIndex = 0; dirtyIndex < indexCount; dirtyIndex += 1) {
      const index = dirtyIndices ? dirtyIndices[dirtyIndex] : dirtyIndex
      const rect = items[index] as NovaRect
      const signature = this.createRectSignature(rect)
      if (signature === batch.signatures[index]) continue

      const offset = batch.itemOffsets[index]
      if (offset < 0) {
        batch.signatures[index] = signature
        continue
      }

      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0 || style.fill.a <= 0) return null
      this.writeSolidRectVertices(batch.data, offset, rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, this.resolveShaderRenderMeta(rect))
      batch.signatures[index] = signature
      changedItems += 1
      dirtyRanges.push({ start: offset, end: offset + SOLID_STRIDE * 6 })
    }

    return {
      dirtyRanges: mergeFloatDirtyRanges(dirtyRanges),
      changedItems,
    }
  }

  /**
   * Выполняет внутреннюю операцию draw texture schema batch.
   */
  private drawTextureSchemaBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    if (items.length === 0) return true

    let batch: TextureBatchCache | null = this._textureBatchCache.get(items) ?? null
    let dirtyRanges: Array<FloatDirtyRange> | null = null
    let changedItems = 0
    const rasterScale = this.resolveTextureRasterScale(items, transform, stats)
    const dirtyIndices = this.resolveSchemaDirtyIndices(items)
    const visibilityKey = this.resolveBatchVisibilityKey(items, transform)

    if (!batch) {
      batch = this.buildTextureBatch(items, stats, rasterScale, transform)
      if (!batch) return false
      batch.contentVersion = contentVersion
      batch.rasterScale = rasterScale
      batch.visibilityKey = visibilityKey
      this._textureBatchCache.set(items, batch)
      this._ownedTextureBatchCaches.add(batch)
    } else if (batch.visibilityKey !== visibilityKey) {
      batch = this.buildTextureBatch(items, stats, rasterScale, transform)
      if (!batch) return false
      batch.contentVersion = contentVersion
      batch.rasterScale = rasterScale
      batch.visibilityKey = visibilityKey
      this._textureBatchCache.set(items, batch)
      this._ownedTextureBatchCaches.add(batch)
    } else if (contentVersion === undefined || batch.contentVersion !== contentVersion || batch.rasterScale !== rasterScale) {
      const update = this.updateTextureBatch(items, batch, stats, rasterScale, transform, dirtyIndices)
      if (!update) {
        batch = this.buildTextureBatch(items, stats, rasterScale, transform)
        if (!batch) return false
        batch.contentVersion = contentVersion
        batch.rasterScale = rasterScale
        batch.visibilityKey = visibilityKey
        this._textureBatchCache.set(items, batch)
        this._ownedTextureBatchCaches.add(batch)
      } else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
        batch.rasterScale = rasterScale
      }
    }

    if (batch.data.length === 0 || !batch.texture) return true

    this.flushRounded(stats)
    this.flushSolid(stats)
    this.prepareTextureTransform(transform, stats)
    if (this._textureData.length > 0 || this._textureCachedData) this.flushTexture(stats)

    this._textureCachedData = batch.data
    this._textureCachedDirtyRanges = dirtyRanges
    this._textureCachedBatch = batch
    stats.instances += batch.instances
    if (dirtyRanges?.length) {
      stats.updatedHandles += changedItems
      stats.dirtyStreamRanges += dirtyRanges.length
    }

    return true
  }

  /**
   * Выполняет внутреннюю операцию build texture batch.
   */
  private buildTextureBatch(
    items: Array<NovaSchemaItem<any>>,
    stats: RenderStats,
    rasterScale?: number,
    transform?: mat3,
  ): TextureBatchCache | null {
    const data: Array<number> = []
    const itemOffsets: Array<number> = new Array(items.length).fill(-1)
    const signatures: Array<string> = new Array(items.length).fill('')
    let texture: TextureEntry | null = null
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const item = this.resolveTextureBatchItem(items[index], stats, rasterScale, transform)
      if (!item) return null
      if (this.isCulledTextureBatchItem(item)) {
        signatures[index] = item.signature
        continue
      }
      if (texture && texture !== item.texture) return null

      texture = item.texture
      signatures[index] = item.signature
      if (item.width <= 0 || item.height <= 0 || item.opacity <= 0) continue

      itemOffsets[index] = data.length
      this.pushTextureQuadVertices(data, item.x, item.y, item.width, item.height, item.opacity, item.u0, item.v0, item.u1, item.v1)
      instances += 1
    }

    return {
      data: new Float32Array(data),
      instances,
      itemOffsets,
      signatures,
      texture,
      upload: createWebGLUploadState(),
      rasterScale,
    }
  }

  /**
   * Обновляет texture batch.
   */
  private updateTextureBatch(
    items: Array<NovaSchemaItem<any>>,
    batch: TextureBatchCache,
    stats: RenderStats,
    rasterScale?: number,
    transform?: mat3,
    dirtyIndices?: ReadonlyArray<number>,
  ): TextureBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) return null

    const dirtyRanges: Array<FloatDirtyRange> = []
    let changedItems = 0

    const indexCount = dirtyIndices?.length ?? items.length
    for (let dirtyIndex = 0; dirtyIndex < indexCount; dirtyIndex += 1) {
      const index = dirtyIndices ? dirtyIndices[dirtyIndex] : dirtyIndex
      const item = this.resolveTextureBatchItem(items[index], stats, rasterScale, transform)
      if (!item) return null
      if (this.isCulledTextureBatchItem(item)) {
        if (batch.itemOffsets[index] >= 0) return null
        batch.signatures[index] = item.signature
        continue
      }
      if (!batch.texture || item.texture !== batch.texture) return null
      if (item.signature === batch.signatures[index]) continue

      const offset = batch.itemOffsets[index]
      if (offset < 0) return null
      if (item.width <= 0 || item.height <= 0 || item.opacity <= 0) return null

      this.writeTextureQuadVertices(batch.data, offset, item.x, item.y, item.width, item.height, item.opacity, item.u0, item.v0, item.u1, item.v1)
      batch.signatures[index] = item.signature
      changedItems += 1
      dirtyRanges.push({ start: offset, end: offset + TEXTURE_STRIDE * 6 })
    }

    return {
      dirtyRanges: mergeFloatDirtyRanges(dirtyRanges),
      changedItems,
    }
  }

  /**
   * Вычисляет texture batch item.
   */
  private resolveTextureBatchItem(
    item: NovaSchemaItem<any>,
    stats: RenderStats,
    rasterScale?: number,
    transform?: mat3,
  ): TextureBatchItem | CulledTextureBatchItem | null {
    if (item.active === false) return null

    if (item.type === 'icon') {
      if (
        transform
        && this.shouldCullTextureItems()
        && !this.isRectVisible(transform, item.x, item.y, item.width, item.height)
      ) {
        return {
          culled: true,
          signature: ['culled-icon', item.x, item.y, item.width, item.height, item.styles?.opacity ?? 1].join('|'),
        }
      }

      const source = typeof item.icon === 'string' ? NovaGraphics.getAsset(item.icon) : item.icon
      if (!source) return null
      const key = typeof item.icon === 'string' ? `icon:${item.icon}` : `icon:${this.resolveSourceKey(source)}`
      let texture = this._textures.get(key)
      if (!texture) texture = this.createTextureFromSource(key, source, stats)
      texture.lastUsed = this._time
      const opacity = item.styles?.opacity ?? 1
      return {
        texture,
        signature: [key, item.x, item.y, item.width, item.height, opacity].join('|'),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        opacity,
        u0: 0,
        v0: 0,
        u1: 1,
        v1: 1,
      }
    }

    if (item.type === 'text') {
      if (
        transform
        && this.shouldCullTextRuns()
        && !this.isRectVisible(transform, item.x, item.y, item.width, item.height)
      ) {
        stats.culledTextRuns += 1
        return {
          culled: true,
          signature: this.createCulledTextSignature(item, rasterScale),
        }
      }
      stats.visibleTextRuns += 1

      const style = compileNovaTextStyle(item)
      const scale = rasterScale ?? this._device.canvas.dpr
      const atlasItem = this.resolveTextAtlasItem(item, style, scale, stats)
      if (!atlasItem) {
        return {
          culled: true,
          signature: ['deferred-text', this.createCulledTextSignature(item, scale)].join('|'),
        }
      }

      return {
        texture: atlasItem.texture,
        signature: [atlasItem.key, item.x, item.y, item.width, item.height, style.opacity].join('|'),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        opacity: style.opacity,
        u0: atlasItem.u0,
        v0: atlasItem.v0,
        u1: atlasItem.u1,
        v1: atlasItem.v1,
      }
    }

    return null
  }

  /**
   * Проверяет culled marker для texture batch.
   */
  private isCulledTextureBatchItem(item: TextureBatchItem | CulledTextureBatchItem): item is CulledTextureBatchItem {
    return 'culled' in item
  }

  /**
   * Создает signature для culled text без rasterize.
   */
  private createCulledTextSignature(text: NovaText, rasterScale?: number): string {
    return [
      'culled-text',
      text.text,
      text.x,
      text.y,
      text.width,
      text.height,
      text.styles?.color,
      text.styles?.font?.family,
      text.styles?.font?.size,
      text.styles?.font?.weight,
      text.styles?.opacity,
      rasterScale ?? 0,
    ].join('|')
  }

  /**
   * Создает rect signature.
   */
  private createRectSignature(rect: NovaRect): string {
    const border = rect.styles?.border
    return [
      rect.active === false ? 0 : 1,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      typeof rect.styles?.background === 'string' ? rect.styles.background : rect.styles?.background ? 'texture' : '',
      rect.styles?.opacity ?? 1,
      border?.color ?? '',
      border?.width ?? 0,
      border?.radius ?? 0,
      border?.dashPattern?.join(',') ?? '',
      this.createShaderMetaSignature(rect),
    ].join('|')
  }

  /**
   * Возвращает shader metadata schema item.
   */
  private resolveShaderRenderMeta(item?: { meta?: any }): NovaShaderRenderMeta | null {
    const meta = item?.meta as NovaShaderRenderMeta | undefined
    if (!meta || typeof meta !== 'object') return null
    if (!meta.animation && !meta.motion) return null
    return meta
  }

  /**
   * Создает signature для shader metadata, которая меняется только при смене конфигурации.
   */
  private createShaderMetaSignature(item: { meta?: any }): string {
    const meta = this.resolveShaderRenderMeta(item)
    if (!meta) return ''
    const animation = resolveAnimationVector(meta)
    const motion = resolveMotionVector(meta)
    return [
      animation.phase,
      animation.speed,
      animation.amplitude,
      motion.speed,
      motion.wrapWidth,
    ].join(',')
  }

  /**
   * Проверяет plain rect.
   */
  private isPlainRect(rect: NovaRect): boolean {
    const background = rect.styles?.background
    const border = rect.styles?.border
    return (!background || typeof background === 'string')
      && (border?.width ?? 0) <= 0
      && (border?.radius ?? 0) <= 0
  }

  /**
   * Выполняет внутреннюю операцию draw primitive.
   */
  private drawPrimitive(item: NovaSchemaItem<any>, transform: mat3, stats: RenderStats): void {
    if (item.active === false) return

    switch (item.type) {
      case 'rect':
        this.drawRect(item, transform, stats)
        break
      case 'border':
        this.drawBorder(item, transform, stats)
        break
      case 'text':
        this.drawText(item, transform, stats)
        break
      case 'line':
        this.drawLine(item, transform, stats)
        break
      case 'circle':
        this.drawCircle(item, transform, stats)
        break
      case 'polygon':
        this.drawPolygon(item, transform, stats)
        break
      case 'icon':
        this.drawIcon(item, transform, stats)
        break
      default:
        break
    }
  }

  /**
   * Выполняет внутреннюю операцию draw rect.
   */
  private drawRect(rect: NovaRect, transform: mat3, stats: RenderStats): void {
    const style = compileNovaRectStyle(rect)
    const background = rect.styles?.background

    if (background && typeof background !== 'string') {
      this.drawTextureSource(`rect-bg:${this.resolveSourceKey(background)}`, background, rect.x, rect.y, rect.width, rect.height, transform, rect.styles?.opacity ?? 1, stats)
    }

    if (!background || typeof background === 'string' || style.borderWidth > 0) {
      if (background !== undefined && typeof background === 'string' && style.borderRadius <= 0 && style.borderWidth <= 0) {
        this.queuePlainRect(rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, transform, stats, rect)
        return
      }
      this.queueRoundedRect(rect.x, rect.y, rect.width, rect.height, style.borderRadius, style.fill, style.opacity, style.borderColor, style.borderWidth, transform, stats, rect)
    }
  }

  /**
   * Выполняет внутреннюю операцию draw border.
   */
  private drawBorder(border: NovaBorder, transform: mat3, stats: RenderStats): void {
    const style = compileNovaBorderStyle(border)
    const position = border.position ?? 'all'

    if (position === 'all' || style.borderRadius > 0) {
      this.queueRoundedRect(border.x, border.y, border.width, border.height, style.borderRadius, style.fill, 1, style.borderColor, style.borderWidth, transform, stats)
      return
    }

    const sides = this.resolveBorderSides(position)
    for (const side of sides) {
      if (side === 'top') this.queueSolidLine(border.x, border.y, border.x + border.width, border.y, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      if (side === 'bottom') this.queueSolidLine(border.x, border.y + border.height, border.x + border.width, border.y + border.height, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      if (side === 'left') this.queueSolidLine(border.x, border.y, border.x, border.y + border.height, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      if (side === 'right') this.queueSolidLine(border.x + border.width, border.y, border.x + border.width, border.y + border.height, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
    }
  }

  /**
   * Выполняет внутреннюю операцию draw text.
   */
  private drawText(text: NovaText, transform: mat3, stats: RenderStats): void {
    if (this.shouldCullTextRuns() && !this.isRectVisible(transform, text.x, text.y, text.width, text.height)) {
      stats.culledTextRuns += 1
      return
    }
    stats.visibleTextRuns += 1

    const style = compileNovaTextStyle(text)
    const scale = this.resolveTextRasterScale(transform, stats)
    const atlasItem = this.resolveTextAtlasItem(text, style, scale, stats)
    if (!atlasItem) return

    this.queueTextureQuad(
      atlasItem.texture,
      text.x,
      text.y,
      text.width,
      text.height,
      transform,
      style.opacity,
      stats,
      atlasItem.u0,
      atlasItem.v0,
      atlasItem.u1,
      atlasItem.v1,
    )
  }

  /**
   * Вычисляет texture raster scale.
   */
  private resolveTextureRasterScale(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats): number | undefined {
    return items.some(item => item.type === 'text') ? this.resolveTextRasterScale(transform, stats) : undefined
  }

  /**
   * Вычисляет text raster scale.
   */
  private resolveTextRasterScale(transform: mat3, stats: RenderStats): number {
    const scaleX = Math.hypot(transform[0], transform[1])
    const scaleY = Math.hypot(transform[3], transform[4])
    const zoom = Math.max(0.01, scaleX, scaleY)
    const nextScale = resolveNovaTextRasterScale(this._textConfig, zoom, this._device.canvas.dpr)

    if (!this._effectiveTextRasterScale) {
      this._effectiveTextRasterScale = nextScale
      this._lastTextBucketSwitchAt = performance.now()
      stats.textBucketChanges += 1
      stats.effectiveTextRasterScale = nextScale
      return nextScale
    }

    if (nextScale === this._effectiveTextRasterScale) {
      stats.effectiveTextRasterScale = this._effectiveTextRasterScale
      return this._effectiveTextRasterScale
    }

    const throttleMs = Math.max(0, this._textConfig.bucketThrottleMs)
    const now = performance.now()
    if (this._textConfig.fallbackPreviousScale && throttleMs > 0 && now - this._lastTextBucketSwitchAt < throttleMs) {
      stats.textRasterDeferred += 1
      stats.effectiveTextRasterScale = this._effectiveTextRasterScale
      return this._effectiveTextRasterScale
    }

    this._effectiveTextRasterScale = nextScale
    this._lastTextBucketSwitchAt = now
    stats.textBucketChanges += 1
    stats.effectiveTextRasterScale = nextScale
    return nextScale
  }

  /**
   * Возвращает drawable text atlas item или откладывает растеризацию по frame budget.
   */
  private resolveTextAtlasItem(
    text: NovaText,
    style: NovaCompiledTextStyle,
    scale: number,
    stats: RenderStats,
  ): TextAtlasDrawableItem | null {
    stats.effectiveTextRasterScale = scale
    const key = this.createTextKey(text, style, scale)
    const current = this._textAtlasEntries.get(key)
    if (current) {
      stats.textCacheHits += 1
      current.lastUsed = this._time
      current.page.lastUsed = this._time
      this.prewarmAdjacentTextBuckets(text, style, scale, stats)
      return this.createTextAtlasDrawableItem(current)
    }

    const baseKey = this.createTextBaseKey(text, style)
    const fallback = this.resolveTextFallbackEntry(baseKey, key)
    const rasterBudgetMs = this.shouldBudgetTextRaster()
      ? Math.max(0, this._textConfig.rasterBudgetMs)
      : Number.POSITIVE_INFINITY
    if (stats.textRasterMs >= rasterBudgetMs) {
      stats.textRasterDeferred += 1
      stats.textBudgetExhausted += 1
      if (fallback && this._textConfig.fallbackPreviousScale) {
        fallback.lastUsed = this._time
        fallback.page.lastUsed = this._time
        return this.createTextAtlasDrawableItem(fallback)
      }
      return null
    }

    stats.textCacheMisses += 1
    const rasterStartedAt = performance.now()
    const raster = this.rasterizeText(text, style, scale)
    stats.textRasterMs += performance.now() - rasterStartedAt
    stats.textRasterCount += 1

    const entry = this.uploadTextAtlasEntry(key, baseKey, raster, stats)
    this._textFallbackKeys.set(baseKey, key)
    stats.textAtlasPages = this._textAtlasPages.length
    this.prewarmAdjacentTextBuckets(text, style, scale, stats)
    return this.createTextAtlasDrawableItem(entry)
  }

  /**
   * Подготавливает соседние text buckets в рамках оставшегося raster budget.
   */
  private prewarmAdjacentTextBuckets(
    text: NovaText,
    style: NovaCompiledTextStyle,
    scale: number,
    stats: RenderStats,
  ): void {
    if (!this._textConfig.prewarmAdjacentBuckets || !this.shouldBudgetTextRaster()) return

    const budgetMs = Math.max(0, this._textConfig.rasterBudgetMs)
    if (stats.textRasterMs >= budgetMs) return

    for (const nextScale of this.resolveAdjacentTextRasterScales(scale)) {
      if (stats.textRasterMs >= budgetMs) {
        stats.textBudgetExhausted += 1
        return
      }

      const key = this.createTextKey(text, style, nextScale)
      if (this._textAtlasEntries.has(key)) continue

      const baseKey = this.createTextBaseKey(text, style)
      const rasterStartedAt = performance.now()
      const raster = this.rasterizeText(text, style, nextScale)
      stats.textRasterMs += performance.now() - rasterStartedAt
      stats.textRasterCount += 1
      this.uploadTextAtlasEntry(key, baseKey, raster, stats)
    }
  }

  /**
   * Возвращает соседние raster scales для prewarm.
   */
  private resolveAdjacentTextRasterScales(scale: number): Array<number> {
    const dpr = Math.max(0.1, this._device.canvas.dpr)
    const scales = this._textConfig.zoomBuckets
      .map(bucket => Math.min(this._textConfig.maxRasterScale, dpr * bucket))
      .filter(bucketScale => Number.isFinite(bucketScale) && bucketScale > 0)
      .sort((a, b) => a - b)
    const index = scales.findIndex(bucketScale => bucketScale === scale)
    if (index < 0) return []

    return [scales[index - 1], scales[index + 1]].filter((item): item is number =>
      typeof item === 'number' && item !== scale,
    )
  }

  /**
   * Возвращает fallback entry другого scale для того же text run.
   */
  private resolveTextFallbackEntry(baseKey: string, currentKey: string): TextAtlasEntry | null {
    const fallbackKey = this._textFallbackKeys.get(baseKey)
    if (!fallbackKey || fallbackKey === currentKey) return null
    return this._textAtlasEntries.get(fallbackKey) ?? null
  }

  /**
   * Создает drawable item из text atlas entry.
   */
  private createTextAtlasDrawableItem(entry: TextAtlasEntry): TextAtlasDrawableItem {
    const page = entry.page
    return {
      key: entry.key,
      texture: page.texture,
      u0: entry.x / page.width,
      v0: entry.y / page.height,
      u1: (entry.x + entry.width) / page.width,
      v1: (entry.y + entry.height) / page.height,
    }
  }

  /**
   * Загружает rasterized text run в atlas page через texSubImage2D.
   */
  private uploadTextAtlasEntry(key: string, baseKey: string, raster: RasterizedText, stats: RenderStats): TextAtlasEntry {
    const page = this.resolveTextAtlasPage(raster.width, raster.height, stats)
    const x = page.cursorX
    const y = page.cursorY

    page.cursorX += raster.width
    page.rowHeight = Math.max(page.rowHeight, raster.height)
    page.entries.add(key)
    page.lastUsed = this._time

    const uploadStartedAt = performance.now()
    this._gl.bindTexture(this._gl.TEXTURE_2D, page.texture.texture)
    this._gl.pixelStorei(this._gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    if (typeof this._gl.texSubImage2D === 'function') {
      this._gl.texSubImage2D(
        this._gl.TEXTURE_2D,
        0,
        x,
        y,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        raster.canvas as TexImageSource,
      )
    }
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, raster.width * raster.height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1

    const entry: TextAtlasEntry = {
      key,
      baseKey,
      page,
      x,
      y,
      width: raster.width,
      height: raster.height,
      scale: raster.scale,
      bytes,
      lastUsed: this._time,
    }
    this._textAtlasEntries.set(key, entry)
    return entry
  }

  /**
   * Возвращает atlas page с местом под rasterized text.
   */
  private resolveTextAtlasPage(width: number, height: number, stats: RenderStats): TextAtlasPage {
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))

    for (const page of this._textAtlasPages) {
      const region = this.tryFitTextAtlasPage(page, w, h)
      if (region) return region
    }

    const pageWidth = Math.max(TEXT_ATLAS_PAGE_SIZE, w)
    const pageHeight = Math.max(TEXT_ATLAS_PAGE_SIZE, h)
    const pageBytes = pageWidth * pageHeight * 4
    this.evictTextAtlasPagesFor(pageBytes)

    const texture = this.createEmptyTextAtlasTexture(pageWidth, pageHeight, stats)
    const page: TextAtlasPage = {
      key: texture.key,
      texture,
      width: pageWidth,
      height: pageHeight,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      entries: new Set(),
      lastUsed: this._time,
    }
    this._textAtlasPages.push(page)
    return page
  }

  /**
   * Проверяет, поместится ли entry на существующую atlas page.
   */
  private tryFitTextAtlasPage(page: TextAtlasPage, width: number, height: number): TextAtlasPage | null {
    if (width > page.width || height > page.height) return null

    if (page.cursorX + width > page.width) {
      page.cursorX = 0
      page.cursorY += page.rowHeight
      page.rowHeight = 0
    }

    if (page.cursorY + height > page.height) return null
    return page
  }

  /**
   * Создает пустую WebGL texture для text atlas page.
   */
  private createEmptyTextAtlasTexture(width: number, height: number, stats: RenderStats): TextureEntry {
    const gl = this._gl
    const texture = gl.createTexture()
    if (!texture) throw new Error('Failed to create WebGL2 text atlas texture')

    const uploadStartedAt = performance.now()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, width * height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1
    return {
      key: `text-atlas:${this._textAtlasPages.length + 1}:${this._time}`,
      texture,
      width,
      height,
      bytes,
      lastUsed: this._time,
    }
  }

  /**
   * Освобождает старые text atlas pages под memory budget.
   */
  private evictTextAtlasPagesFor(nextPageBytes: number): void {
    const budgetBytes = Math.max(1, this._textConfig.maxAtlasMemoryMB) * 1024 * 1024
    let bytes = this.textAtlasMemoryBytes()
    if (bytes + nextPageBytes <= budgetBytes || this._textAtlasPages.length === 0) return

    const pages = [...this._textAtlasPages].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const page of pages) {
      if (bytes + nextPageBytes <= budgetBytes && this._textAtlasPages.length > 0) break

      this._gl.deleteTexture(page.texture.texture)
      const index = this._textAtlasPages.indexOf(page)
      if (index >= 0) this._textAtlasPages.splice(index, 1)
      for (const key of page.entries) this._textAtlasEntries.delete(key)
      bytes -= page.texture.bytes
    }
  }

  /**
   * Проверяет screen-space видимость rect.
   */
  private isRectVisible(transform: mat3, x: number, y: number, width: number, height: number): boolean {
    if (width <= 0 || height <= 0) return false

    const bounds = transformRectBounds(transform, x, y, width, height)
    return bounds.x + bounds.width >= 0
      && bounds.y + bounds.height >= 0
      && bounds.x <= this._viewportWidth
      && bounds.y <= this._viewportHeight
  }

  /**
   * Проверяет, включена ли policy-driven culling для text runs.
   */
  private shouldCullTextRuns(): boolean {
    return this._textConfig.mode === 'run-atlas' && this._textConfig.visibleOnlyRaster
  }

  /**
   * Проверяет, включен ли culling для texture stream.
   */
  private shouldCullTextureItems(): boolean {
    return this._textConfig.mode === 'run-atlas' && this._textConfig.visibleOnlyRaster
  }

  /**
   * Проверяет, включен ли viewport culling для geometry streams.
   */
  private shouldCullGeometryItems(): boolean {
    return false
  }

  /**
   * Создает ключ viewport visibility для batches, зависящих от transform.
   */
  private resolveBatchVisibilityKey(items: Array<NovaSchemaItem<any>>, transform: mat3): string | undefined {
    const hasText = items.some(item => item.type === 'text' || item.type === 'icon')
    if (!hasText || !this.shouldCullTextureItems()) return undefined

    return [
      this._viewportWidth,
      this._viewportHeight,
      transform[0].toFixed(4),
      transform[1].toFixed(4),
      transform[3].toFixed(4),
      transform[4].toFixed(4),
      transform[6].toFixed(2),
      transform[7].toFixed(2),
    ].join('|')
  }

  /**
   * Проверяет, включен ли frame budget для text rasterization.
   */
  private shouldBudgetTextRaster(): boolean {
    return this._textConfig.mode === 'run-atlas'
  }

  /**
   * Выполняет внутреннюю операцию draw line.
   */
  private drawLine(line: NovaLine, transform: mat3, stats: RenderStats): void {
    const style = compileNovaLineStyle(line)
    this.queueSolidLine(line.x1, line.y1, line.x2, line.y2, style.width, style.color, style.opacity, transform, stats, style.dashPattern)
  }

  /**
   * Выполняет внутреннюю операцию draw circle.
   */
  private drawCircle(circle: NovaCircle, transform: mat3, stats: RenderStats): void {
    const style = compileNovaCircleStyle(circle)
    const diameter = circle.radius * 2
    this.queueRoundedRect(circle.x - circle.radius, circle.y - circle.radius, diameter, diameter, circle.radius, style.fill, style.opacity, style.borderColor, style.borderWidth, transform, stats)
  }

  /**
   * Выполняет внутреннюю операцию draw polygon.
   */
  private drawPolygon(polygon: NovaPolygon, transform: mat3, stats: RenderStats): void {
    if (polygon.points.length < 3) return

    const style = compileNovaPolygonStyle(polygon)
    if (style.fill.a > 0) {
      const first = polygon.points[0]
      for (let i = 1; i < polygon.points.length - 1; i += 1) {
        this.queueSolidTriangle(first.x, first.y, polygon.points[i].x, polygon.points[i].y, polygon.points[i + 1].x, polygon.points[i + 1].y, style.fill, style.opacity, transform, stats)
      }
    }

    if (style.stroke.a > 0 && style.lineWidth > 0) {
      for (let i = 0; i < polygon.points.length; i += 1) {
        const a = polygon.points[i]
        const b = polygon.points[(i + 1) % polygon.points.length]
        this.queueSolidLine(a.x, a.y, b.x, b.y, style.lineWidth, style.stroke, style.opacity, transform, stats)
      }
    }
  }

  /**
   * Выполняет внутреннюю операцию draw icon.
   */
  private drawIcon(icon: NovaIcon, transform: mat3, stats: RenderStats): void {
    const source = typeof icon.icon === 'string' ? NovaGraphics.getAsset(icon.icon) : icon.icon
    if (!source) return
    const key = typeof icon.icon === 'string' ? `icon:${icon.icon}` : `icon:${this.resolveSourceKey(source)}`
    this.drawTextureSource(key, source, icon.x, icon.y, icon.width, icon.height, transform, icon.styles?.opacity ?? 1, stats)
  }

  /**
   * Рисует retained rect batch через specialized instanced stream.
   */
  private drawRectBatch(batch: NovaRectBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) return

    let cache = this._rectStreamBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let geometryDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count) {
      cache = this.createRectStreamBatchCache(batch)
      this._rectStreamBatchCache.set(batch, cache)
      this._ownedRectStreamBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this.writeRectBatchGeometry(batch, cache.geometryData)
      cache.revision = revision
      geometryDirty = [{ start: 0, end: batch.count * RECT_BATCH_GEOMETRY_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this.writeRectBatchStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * RECT_BATCH_STATIC_STRIDE }]
    }

    this.flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.geometryBuffer)
    this.uploadArrayBuffer(cache.geometryData, cache.geometryUpload, stats, geometryDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this.uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._rectBatchProgram.use()
    gl.uniform2f(this._rectBatchProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._rectBatchProgram.uniformLocation('u_transform'), false, transform)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (geometryDirty || staticDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += Number(Boolean(geometryDirty)) + Number(Boolean(staticDirty))
    }
  }

  /**
   * Рисует retained particle batch через specialized instanced stream.
   */
  private drawParticleBatch(batch: NovaParticleBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) return

    if (batch.kind === 'sprite') {
      this.drawSpriteParticleBatch(batch, transform, stats)
      return
    }

    this.drawCircleParticleBatch(batch, transform, stats)
  }

  /**
   * Рисует circle particles через analytic shader.
   */
  private drawCircleParticleBatch(batch: NovaParticleBatch, transform: mat3, stats: RenderStats): void {
    let cache = this._particleCircleBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let positionDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count) {
      cache = this.createCircleParticleCache(batch)
      this._particleCircleBatchCache.set(batch, cache)
      this._ownedParticleCircleBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this.writeParticlePositions(batch, cache.positionData)
      cache.revision = revision
      positionDirty = [{ start: 0, end: batch.count * PARTICLE_POSITION_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this.writeCircleParticleStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * PARTICLE_CIRCLE_STATIC_STRIDE }]
    }

    this.flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.positionBuffer)
    this.uploadArrayBuffer(cache.positionData, cache.positionUpload, stats, positionDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this.uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._particleCircleProgram.use()
    gl.uniform2f(this._particleCircleProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._particleCircleProgram.uniformLocation('u_transform'), false, transform)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (positionDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += 1
    }
  }

  /**
   * Рисует sprite particles через texture instancing.
   */
  private drawSpriteParticleBatch(batch: NovaParticleBatch, transform: mat3, stats: RenderStats): void {
    const source = typeof batch.texture === 'string' ? NovaGraphics.getAsset(batch.texture) : batch.texture
    if (!source) return

    const textureKey = typeof batch.texture === 'string' ? `particle:${batch.texture}` : `particle:${this.resolveSourceKey(source)}`
    let texture = this._textures.get(textureKey)
    if (!texture) texture = this.createTextureFromSource(textureKey, source, stats)
    texture.lastUsed = this._time

    let cache = this._particleSpriteBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let positionDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count || cache.texture !== texture) {
      cache = this.createSpriteParticleCache(batch, texture)
      this._particleSpriteBatchCache.set(batch, cache)
      this._ownedParticleSpriteBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this.writeParticlePositions(batch, cache.positionData)
      cache.revision = revision
      positionDirty = [{ start: 0, end: batch.count * PARTICLE_POSITION_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this.writeSpriteParticleStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * PARTICLE_SPRITE_STATIC_STRIDE }]
    }

    this.flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.positionBuffer)
    this.uploadArrayBuffer(cache.positionData, cache.positionUpload, stats, positionDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this.uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._particleSpriteProgram.use()
    gl.uniform2f(this._particleSpriteProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._particleSpriteProgram.uniformLocation('u_transform'), false, transform)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture.texture)
    gl.uniform1i(this._particleSpriteProgram.uniformLocation('u_texture'), 0)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (positionDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += 1
    }
  }

  /**
   * Выполняет внутреннюю операцию draw texture source.
   */
  private drawTextureSource(
    key: string,
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    opacity: number,
    stats: RenderStats,
  ): void {
    let texture = this._textures.get(key)
    if (!texture) texture = this.createTextureFromSource(key, source, stats)
    texture.lastUsed = this._time
    this.queueTextureQuad(texture, x, y, width, height, transform, opacity, stats)
  }

  /**
   * Создает cache для circle particle batch.
   */
  private createCircleParticleCache(batch: NovaParticleBatch): ParticleCircleBatchCache {
    const positionBuffer = this.createBuffer()
    const staticBuffer = this.createBuffer()
    const cache: ParticleCircleBatchCache = {
      positionData: new Float32Array(batch.count * PARTICLE_POSITION_STRIDE),
      staticData: new Float32Array(batch.count * PARTICLE_CIRCLE_STATIC_STRIDE),
      count: batch.count,
      positionUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      positionBuffer,
      staticBuffer,
      vao: this.createParticleCircleVao(positionBuffer, staticBuffer),
    }

    this.writeParticlePositions(batch, cache.positionData)
    this.writeCircleParticleStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Создает cache для sprite particle batch.
   */
  private createSpriteParticleCache(batch: NovaParticleBatch, texture: TextureEntry): ParticleSpriteBatchCache {
    const positionBuffer = this.createBuffer()
    const staticBuffer = this.createBuffer()
    const cache: ParticleSpriteBatchCache = {
      positionData: new Float32Array(batch.count * PARTICLE_POSITION_STRIDE),
      staticData: new Float32Array(batch.count * PARTICLE_SPRITE_STATIC_STRIDE),
      count: batch.count,
      texture,
      positionUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      positionBuffer,
      staticBuffer,
      vao: this.createParticleSpriteVao(positionBuffer, staticBuffer),
    }

    this.writeParticlePositions(batch, cache.positionData)
    this.writeSpriteParticleStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Создает cache для instanced rect batch.
   */
  private createRectStreamBatchCache(batch: NovaRectBatch): RectStreamBatchCache {
    const geometryBuffer = this.createBuffer()
    const staticBuffer = this.createBuffer()
    const cache: RectStreamBatchCache = {
      geometryData: new Float32Array(batch.count * RECT_BATCH_GEOMETRY_STRIDE),
      staticData: new Float32Array(batch.count * RECT_BATCH_STATIC_STRIDE),
      count: batch.count,
      geometryUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      geometryBuffer,
      staticBuffer,
      vao: this.createRectBatchVao(geometryBuffer, staticBuffer),
    }

    this.writeRectBatchGeometry(batch, cache.geometryData)
    this.writeRectBatchStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Записывает dynamic rect geometry.
   */
  private writeRectBatchGeometry(batch: NovaRectBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      const offset = index * RECT_BATCH_GEOMETRY_STRIDE
      target[offset] = batch.x[index] ?? 0
      target[offset + 1] = batch.y[index] ?? 0
      target[offset + 2] = batch.width[index] ?? 0
      target[offset + 3] = batch.height[index] ?? 0
    }
  }

  /**
   * Записывает static rect paint/state attributes.
   */
  private writeRectBatchStaticData(batch: NovaRectBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const colorOffset = index * 4
      const targetOffset = index * RECT_BATCH_STATIC_STRIDE
      target[targetOffset] = batch.colors[colorOffset] ?? 0
      target[targetOffset + 1] = batch.colors[colorOffset + 1] ?? 0
      target[targetOffset + 2] = batch.colors[colorOffset + 2] ?? 0
      target[targetOffset + 3] = (batch.colors[colorOffset + 3] ?? 1) * opacity
      target[targetOffset + 4] = batch.states?.[index] ?? 0
    }
  }

  /**
   * Записывает dynamic particle positions.
   */
  private writeParticlePositions(batch: NovaParticleBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      target[index * 2] = batch.positions[index * 2] ?? 0
      target[index * 2 + 1] = batch.positions[index * 2 + 1] ?? 0
    }
  }

  /**
   * Записывает static circle particle attributes.
   */
  private writeCircleParticleStaticData(batch: NovaParticleBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const fillOffset = index * 4
      const strokeOffset = index * 4
      const targetOffset = index * PARTICLE_CIRCLE_STATIC_STRIDE

      target[targetOffset] = batch.sizes[index] ?? 1
      target[targetOffset + 1] = batch.colors[fillOffset] ?? 1
      target[targetOffset + 2] = batch.colors[fillOffset + 1] ?? 1
      target[targetOffset + 3] = batch.colors[fillOffset + 2] ?? 1
      target[targetOffset + 4] = (batch.colors[fillOffset + 3] ?? 1) * opacity
      target[targetOffset + 5] = batch.strokeColors?.[strokeOffset] ?? 1
      target[targetOffset + 6] = batch.strokeColors?.[strokeOffset + 1] ?? 1
      target[targetOffset + 7] = batch.strokeColors?.[strokeOffset + 2] ?? 1
      target[targetOffset + 8] = (batch.strokeColors?.[strokeOffset + 3] ?? 0) * opacity
      target[targetOffset + 9] = batch.strokeWidths?.[index] ?? 0
    }
  }

  /**
   * Записывает static sprite particle attributes.
   */
  private writeSpriteParticleStaticData(batch: NovaParticleBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const targetOffset = index * PARTICLE_SPRITE_STATIC_STRIDE
      const colorOffset = index * 4
      target[targetOffset] = batch.sizes[index] ?? 1
      target[targetOffset + 1] = (batch.colors[colorOffset + 3] ?? 1) * opacity
    }
  }

  /**
   * Выполняет внутреннюю операцию queue rounded rect.
   */
  private queueRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
    transform: mat3,
    stats: RenderStats,
    source?: NovaSchemaItem<any>,
  ): void {
    if (width <= 0 || height <= 0) return
    if (fill.a <= 0 && (border.a <= 0 || borderWidth <= 0)) return
    this.flushTexture(stats)
    this.flushSolid(stats)
    this.prepareRoundedTransform(transform, stats)

    this.pushRoundedRectVertices(this._rectData, x, y, width, height, radius, fill, opacity, border, borderWidth, this.resolveShaderRenderMeta(source))
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию queue plain rect.
   */
  private queuePlainRect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    source?: NovaSchemaItem<any>,
  ): void {
    if (width <= 0 || height <= 0 || fill.a <= 0) return
    this.flushTexture(stats)
    this.flushRounded(stats)
    this.prepareSolidTransform(transform, stats)

    this.pushSolidRectVertices(this._solidData, x, y, width, height, fill, opacity, this.resolveShaderRenderMeta(source))
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию push rounded rect vertices.
   */
  private pushRoundedRectVertices(
    target: Array<number>,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
    meta?: NovaShaderRenderMeta | null,
  ): void {
    const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    const animation = resolveAnimationVector(meta)
    const motion = resolveMotionVector(meta)
    const vertices = [
      [x, y, 0, 0],
      [x + width, y, width, 0],
      [x, y + height, 0, height],
      [x, y + height, 0, height],
      [x + width, y, width, 0],
      [x + width, y + height, width, height],
    ]

    for (const [px, py, localX, localY] of vertices) {
      target.push(
        px,
        py,
        localX,
        localY,
        width,
        height,
        clampedRadius,
        fill.r,
        fill.g,
        fill.b,
        fill.a * opacity,
        border.r,
        border.g,
        border.b,
        border.a * opacity,
        borderWidth,
        animation.phase,
        animation.speed,
        animation.amplitude,
        motion.speed,
        motion.wrapWidth,
      )
    }
  }

  /**
   * Записывает rounded rect vertices.
   */
  private writeRoundedRectVertices(
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
    meta?: NovaShaderRenderMeta | null,
  ): void {
    const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    const animation = resolveAnimationVector(meta)
    const motion = resolveMotionVector(meta)
    const vertices = [
      [x, y, 0, 0],
      [x + width, y, width, 0],
      [x, y + height, 0, height],
      [x, y + height, 0, height],
      [x + width, y, width, 0],
      [x + width, y + height, width, height],
    ]

    let cursor = offset
    for (const [px, py, localX, localY] of vertices) {
      target[cursor++] = px
      target[cursor++] = py
      target[cursor++] = localX
      target[cursor++] = localY
      target[cursor++] = width
      target[cursor++] = height
      target[cursor++] = clampedRadius
      target[cursor++] = fill.r
      target[cursor++] = fill.g
      target[cursor++] = fill.b
      target[cursor++] = fill.a * opacity
      target[cursor++] = border.r
      target[cursor++] = border.g
      target[cursor++] = border.b
      target[cursor++] = border.a * opacity
      target[cursor++] = borderWidth
      target[cursor++] = animation.phase
      target[cursor++] = animation.speed
      target[cursor++] = animation.amplitude
      target[cursor++] = motion.speed
      target[cursor++] = motion.wrapWidth
    }
  }

  /**
   * Выполняет внутреннюю операцию push solid rect vertices.
   */
  private pushSolidRectVertices(target: Array<number>, x: number, y: number, width: number, height: number, fill: NovaParsedColor, opacity: number, meta?: NovaShaderRenderMeta | null): void {
    const animation = resolveAnimationVector(meta)
    this.pushSolidVertexTo(target, x, y, fill, opacity, animation)
    this.pushSolidVertexTo(target, x + width, y, fill, opacity, animation)
    this.pushSolidVertexTo(target, x, y + height, fill, opacity, animation)
    this.pushSolidVertexTo(target, x, y + height, fill, opacity, animation)
    this.pushSolidVertexTo(target, x + width, y, fill, opacity, animation)
    this.pushSolidVertexTo(target, x + width, y + height, fill, opacity, animation)
  }

  /**
   * Записывает solid rect vertices.
   */
  private writeSolidRectVertices(target: Float32Array, offset: number, x: number, y: number, width: number, height: number, fill: NovaParsedColor, opacity: number, meta?: NovaShaderRenderMeta | null): void {
    const animation = resolveAnimationVector(meta)
    const vertices = [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x, y + height],
      [x + width, y],
      [x + width, y + height],
    ]

    let cursor = offset
    for (const [px, py] of vertices) {
      target[cursor++] = px
      target[cursor++] = py
      target[cursor++] = fill.r
      target[cursor++] = fill.g
      target[cursor++] = fill.b
      target[cursor++] = fill.a * opacity
      target[cursor++] = animation.phase
      target[cursor++] = animation.speed
      target[cursor++] = animation.amplitude
    }
  }

  /**
   * Выполняет внутреннюю операцию queue solid triangle.
   */
  private queueSolidTriangle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
  ): void {
    this.flushTexture(stats)
    this.flushRounded(stats)
    this.prepareSolidTransform(transform, stats)
    this.pushSolidVertex(x1, y1, color, opacity)
    this.pushSolidVertex(x2, y2, color, opacity)
    this.pushSolidVertex(x3, y3, color, opacity)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию queue solid line.
   */
  private queueSolidLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    dashPattern?: Array<number>,
  ): void {
    if (width <= 0 || color.a <= 0) return
    if (dashPattern?.length && dashPattern[0] > 0 && dashPattern[1] > 0) {
      this.queueDashedLine(x1, y1, x2, y2, width, color, opacity, transform, stats, dashPattern)
      return
    }

    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    if (length <= 0) return

    this.flushTexture(stats)
    this.flushRounded(stats)
    this.prepareSolidTransform(transform, stats)

    const nx = (-dy / length) * (width / 2)
    const ny = (dx / length) * (width / 2)
    this.pushSolidVertex(x1 - nx, y1 - ny, color, opacity)
    this.pushSolidVertex(x2 - nx, y2 - ny, color, opacity)
    this.pushSolidVertex(x1 + nx, y1 + ny, color, opacity)
    this.pushSolidVertex(x1 + nx, y1 + ny, color, opacity)
    this.pushSolidVertex(x2 - nx, y2 - ny, color, opacity)
    this.pushSolidVertex(x2 + nx, y2 + ny, color, opacity)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию queue dashed line.
   */
  private queueDashedLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    dashPattern: Array<number>,
  ): void {
    const dash = dashPattern[0] ?? 0
    const gap = dashPattern[1] ?? 0
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    if (length <= 0) return

    const ux = dx / length
    const uy = dy / length
    let offset = 0
    while (offset < length) {
      const end = Math.min(offset + dash, length)
      this.queueSolidLine(
        x1 + ux * offset,
        y1 + uy * offset,
        x1 + ux * end,
        y1 + uy * end,
        width,
        color,
        opacity,
        transform,
        stats,
      )
      offset += dash + gap
    }
  }

  /**
   * Выполняет внутреннюю операцию queue texture quad.
   */
  private queueTextureQuad(
    texture: TextureEntry,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    opacity: number,
    stats: RenderStats,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    if (width <= 0 || height <= 0 || opacity <= 0) return
    this.flushRounded(stats)
    this.flushSolid(stats)
    this.prepareTextureTransform(transform, stats)

    if (this._textureCachedData) this.flushTexture(stats)
    if (this._textureBatch && this._textureBatch !== texture) this.flushTexture(stats)
    this._textureBatch = texture

    this.pushTextureQuadVertices(this._textureData, x, y, width, height, opacity, u0, v0, u1, v1)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию push texture quad vertices.
   */
  private pushTextureQuadVertices(
    target: Array<number>,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const vertices = [
      [x, y, u0, v0],
      [x + width, y, u1, v0],
      [x, y + height, u0, v1],
      [x, y + height, u0, v1],
      [x + width, y, u1, v0],
      [x + width, y + height, u1, v1],
    ]

    for (const [px, py, u, v] of vertices) {
      target.push(px, py, u, v, 1, 1, 1, opacity)
    }
  }

  /**
   * Записывает texture quad vertices.
   */
  private writeTextureQuadVertices(
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const vertices = [
      [x, y, u0, v0],
      [x + width, y, u1, v0],
      [x, y + height, u0, v1],
      [x, y + height, u0, v1],
      [x + width, y, u1, v0],
      [x + width, y + height, u1, v1],
    ]

    let cursor = offset
    for (const [px, py, u, v] of vertices) {
      target[cursor++] = px
      target[cursor++] = py
      target[cursor++] = u
      target[cursor++] = v
      target[cursor++] = 1
      target[cursor++] = 1
      target[cursor++] = 1
      target[cursor++] = opacity
    }
  }

  /**
   * Выполняет внутреннюю операцию push solid vertex.
   */
  private pushSolidVertex(x: number, y: number, color: NovaParsedColor, opacity: number): void {
    this._solidData.push(x, y, color.r, color.g, color.b, color.a * opacity, 0, 0, 0)
  }

  /**
   * Выполняет внутреннюю операцию push solid vertex to.
   */
  private pushSolidVertexTo(target: Array<number>, x: number, y: number, color: NovaParsedColor, opacity: number, animation = EMPTY_SHADER_ANIMATION): void {
    target.push(x, y, color.r, color.g, color.b, color.a * opacity, animation.phase, animation.speed, animation.amplitude)
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private flush(stats: RenderStats): void {
    this.flushRounded(stats)
    this.flushSolid(stats)
    this.flushTexture(stats)
  }

  /**
   * Выполняет внутреннюю операцию prepare rounded transform.
   */
  private prepareRoundedTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._roundedTransform, transform)) return
    this.flushRounded(stats)
    mat3.copy(this._roundedTransform, transform)
  }

  /**
   * Выполняет внутреннюю операцию prepare solid transform.
   */
  private prepareSolidTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._solidTransform, transform)) return
    this.flushSolid(stats)
    mat3.copy(this._solidTransform, transform)
  }

  /**
   * Выполняет внутреннюю операцию prepare texture transform.
   */
  private prepareTextureTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._textureTransform, transform)) return
    this.flushTexture(stats)
    mat3.copy(this._textureTransform, transform)
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private flushRounded(stats: RenderStats): void {
    if (this._rectData.length === 0 && !this._rectCachedData) return
    const gl = this._gl
    const data = this._rectCachedData ?? new Float32Array(this._rectData)
    const dirtyRanges = this._rectCachedData ? this._rectCachedDirtyRanges : null
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this._roundedVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._roundedBuffer)
    this.uploadArrayBuffer(data, this._roundedUpload, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._roundedProgram.use()
    gl.uniform2f(this._roundedProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._roundedProgram.uniformLocation('u_transform'), false, this._roundedTransform)
    gl.uniform1f(this._roundedProgram.uniformLocation('u_time'), this._time)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / RECT_STRIDE)

    stats.drawCalls += 1
    stats.batches += 1
    this._rectData = []
    this._rectCachedData = null
    this._rectCachedDirtyRanges = null
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private flushSolid(stats: RenderStats): void {
    if (this._solidData.length === 0 && !this._solidCachedData) return
    const gl = this._gl
    const data = this._solidCachedData ?? new Float32Array(this._solidData)
    const dirtyRanges = this._solidCachedData ? this._solidCachedDirtyRanges : null
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this._solidVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._solidBuffer)
    this.uploadArrayBuffer(data, this._solidUpload, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._solidProgram.use()
    gl.uniform2f(this._solidProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._solidProgram.uniformLocation('u_transform'), false, this._solidTransform)
    gl.uniform1f(this._solidProgram.uniformLocation('u_time'), this._time)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / SOLID_STRIDE)

    stats.drawCalls += 1
    stats.batches += 1
    this._solidData = []
    this._solidCachedData = null
    this._solidCachedDirtyRanges = null
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private flushTexture(stats: RenderStats): void {
    if (this._textureData.length === 0 && !this._textureCachedData) return
    const texture = this._textureCachedBatch?.texture ?? this._textureBatch
    if (!texture) {
      this._textureData = []
      this._textureBatch = null
      this._textureCachedData = null
      this._textureCachedDirtyRanges = null
      this._textureCachedBatch = null
      return
    }

    const gl = this._gl
    const data = this._textureCachedData ?? new Float32Array(this._textureData)
    const dirtyRanges = this._textureCachedData ? this._textureCachedDirtyRanges : null
    const upload = this._textureCachedBatch?.upload ?? this._textureUpload
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this.resolveTextureVao(this._textureCachedBatch))
    gl.bindBuffer(gl.ARRAY_BUFFER, this.resolveTextureBuffer(this._textureCachedBatch))
    this.uploadArrayBuffer(data, upload, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._textureProgram.use()
    gl.uniform2f(this._textureProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._textureProgram.uniformLocation('u_transform'), false, this._textureTransform)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture.texture)
    gl.uniform1i(this._textureProgram.uniformLocation('u_texture'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / TEXTURE_STRIDE)

    stats.drawCalls += 1
    stats.batches += 1
    this._textureData = []
    this._textureBatch = null
    this._textureCachedData = null
    this._textureCachedDirtyRanges = null
    this._textureCachedBatch = null
  }

  /**
   * Выполняет внутреннюю операцию upload array buffer.
   */
  private uploadArrayBuffer(data: Float32Array, state: WebGLUploadState, stats: RenderStats, dirtyRanges: Array<FloatDirtyRange> | null = null): void {
    const gl = this._gl
    stats.gpuBufferCapacityBytes += Math.max(state.capacityBytes, data.byteLength)

    if (state.lastData === data && state.capacityBytes >= data.byteLength) {
      if (dirtyRanges?.length) {
        const byteRanges = state.arena.mergeDirtyRanges(dirtyRanges.map(range => ({
          start: Math.max(0, range.start) * FLOAT_BYTES,
          end: Math.min(data.length, range.end) * FLOAT_BYTES,
        })))

        if (state.arena.shouldUploadFull(data.byteLength, byteRanges)) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
          stats.bufferSubDataCalls += 1
          stats.fullUploads += 1
          stats.dirtyRangeCount += 1
          stats.uploadBytes += data.byteLength
          return
        }

        for (const range of byteRanges) {
          const start = Math.floor(range.start / FLOAT_BYTES)
          const end = Math.ceil(range.end / FLOAT_BYTES)
          if (end <= start) continue
          gl.bufferSubData(gl.ARRAY_BUFFER, start * FLOAT_BYTES, data.subarray(start, end))
          stats.bufferSubDataCalls += 1
          stats.dirtyRangeCount += 1
          stats.uploadBytes += (end - start) * FLOAT_BYTES
        }
      }
      return
    }

    if (state.capacityBytes >= data.byteLength) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
      state.lastData = data
      stats.bufferSubDataCalls += 1
      stats.dirtyRangeCount += 1
      stats.uploadBytes += data.byteLength
      return
    }

    state.arena.ensureCapacity(data.byteLength)
    gl.bufferData(gl.ARRAY_BUFFER, state.arena.capacityBytes, gl.DYNAMIC_DRAW)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
    state.capacityBytes = state.arena.capacityBytes
    state.lastData = data
    stats.bufferDataCalls += 1
    stats.bufferSubDataCalls += 1
    stats.fullUploads += 1
    stats.dirtyRangeCount += 1
    stats.uploadBytes += data.byteLength
  }

  /**
   * Создает buffer.
   */
  private createBuffer(): WebGLBuffer {
    const buffer = this._gl.createBuffer()
    if (!buffer) throw new Error('Failed to create WebGL2 buffer')
    return buffer
  }

  /**
   * Создает rounded vao.
   */
  private createRoundedVao(): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this.createVao()
    const stride = RECT_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._roundedBuffer)
    this.bindAttrib(this._roundedProgram, 'a_position', 2, stride, 0)
    this.bindAttrib(this._roundedProgram, 'a_local', 2, stride, 2)
    this.bindAttrib(this._roundedProgram, 'a_size', 2, stride, 4)
    this.bindAttrib(this._roundedProgram, 'a_radius', 1, stride, 6)
    this.bindAttrib(this._roundedProgram, 'a_fill', 4, stride, 7)
    this.bindAttrib(this._roundedProgram, 'a_border', 4, stride, 11)
    this.bindAttrib(this._roundedProgram, 'a_borderWidth', 1, stride, 15)
    this.bindAttrib(this._roundedProgram, 'a_animation', 3, stride, 16)
    this.bindAttrib(this._roundedProgram, 'a_motion', 2, stride, 19)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает solid vao.
   */
  private createSolidVao(): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this.createVao()
    const stride = SOLID_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._solidBuffer)
    this.bindAttrib(this._solidProgram, 'a_position', 2, stride, 0)
    this.bindAttrib(this._solidProgram, 'a_color', 4, stride, 2)
    this.bindAttrib(this._solidProgram, 'a_animation', 3, stride, 6)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает texture vao.
   */
  private createTextureVao(buffer: WebGLBuffer = this._textureBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this.createVao()
    const stride = TEXTURE_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    this.bindAttrib(this._textureProgram, 'a_position', 2, stride, 0)
    this.bindAttrib(this._textureProgram, 'a_uv', 2, stride, 2)
    this.bindAttrib(this._textureProgram, 'a_color', 4, stride, 4)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для circle particle stream.
   */
  private createParticleCircleVao(positionBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this.createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this.bindAttribDivisor(this._particleCircleProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    this.bindAttribDivisor(this._particleCircleProgram, 'a_center', 2, PARTICLE_POSITION_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = PARTICLE_CIRCLE_STATIC_STRIDE * FLOAT_BYTES
    this.bindAttribDivisor(this._particleCircleProgram, 'a_radius', 1, stride, 0, 1)
    this.bindAttribDivisor(this._particleCircleProgram, 'a_fill', 4, stride, 1, 1)
    this.bindAttribDivisor(this._particleCircleProgram, 'a_stroke', 4, stride, 5, 1)
    this.bindAttribDivisor(this._particleCircleProgram, 'a_strokeWidth', 1, stride, 9, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для sprite particle stream.
   */
  private createParticleSpriteVao(positionBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this.createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this.bindAttribDivisor(this._particleSpriteProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    this.bindAttribDivisor(this._particleSpriteProgram, 'a_position', 2, PARTICLE_POSITION_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = PARTICLE_SPRITE_STATIC_STRIDE * FLOAT_BYTES
    this.bindAttribDivisor(this._particleSpriteProgram, 'a_size', 1, stride, 0, 1)
    this.bindAttribDivisor(this._particleSpriteProgram, 'a_opacity', 1, stride, 1, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для rect batch stream.
   */
  private createRectBatchVao(geometryBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this.createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this.bindAttribDivisor(this._rectBatchProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer)
    this.bindAttribDivisor(this._rectBatchProgram, 'a_rect', 4, RECT_BATCH_GEOMETRY_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = RECT_BATCH_STATIC_STRIDE * FLOAT_BYTES
    this.bindAttribDivisor(this._rectBatchProgram, 'a_color', 4, stride, 0, 1)
    this.bindAttribDivisor(this._rectBatchProgram, 'a_state', 1, stride, 4, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает vao.
   */
  private createVao(): WebGLVertexArrayObject {
    const vao = this._gl.createVertexArray()
    if (!vao) throw new Error('Failed to create WebGL2 vertex array')
    return vao
  }

  /**
   * Выполняет внутреннюю операцию bind attrib.
   */
  private bindAttrib(program: NovaWebGLProgram, name: string, size: number, stride: number, offsetFloats: number): void {
    const location = program.attribLocation(name)
    this._gl.enableVertexAttribArray(location)
    this._gl.vertexAttribPointer(location, size, this._gl.FLOAT, false, stride, offsetFloats * FLOAT_BYTES)
  }

  /**
   * Привязывает instanced attribute.
   */
  private bindAttribDivisor(program: NovaWebGLProgram, name: string, size: number, stride: number, offsetFloats: number, divisor: number): void {
    const location = program.attribLocation(name)
    this._gl.enableVertexAttribArray(location)
    this._gl.vertexAttribPointer(location, size, this._gl.FLOAT, false, stride, offsetFloats * FLOAT_BYTES)
    this._gl.vertexAttribDivisor(location, divisor)
  }

  /**
   * Загружает shared unit quad для instanced particle streams.
   */
  private initializeParticleQuadBuffer(): void {
    const quad = new Float32Array([
      -1,
-1,
      1,
-1,
      -1,
1,
      -1,
1,
      1,
-1,
      1,
1,
    ])
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._gl.bufferData(this._gl.ARRAY_BUFFER, quad, this._gl.STATIC_DRAW)
  }

  /**
   * Вычисляет texture buffer.
   */
  private resolveTextureBuffer(batch: TextureBatchCache | null): WebGLBuffer {
    if (!batch) return this._textureBuffer
    if (!batch.buffer) batch.buffer = this.createBuffer()
    return batch.buffer
  }

  /**
   * Вычисляет texture vao.
   */
  private resolveTextureVao(batch: TextureBatchCache | null): WebGLVertexArrayObject {
    if (!batch) return this._textureVao
    if (!batch.vao) batch.vao = this.createTextureVao(this.resolveTextureBuffer(batch))
    return batch.vao
  }

  /**
   * Создает texture from source.
   */
  private createTextureFromSource(key: string, source: CanvasImageSource, stats: RenderStats): TextureEntry {
    const gl = this._gl
    const texture = gl.createTexture()
    if (!texture) throw new Error('Failed to create WebGL2 texture')

    const width = resolveSourceWidth(source)
    const height = resolveSourceHeight(source)
    const uploadStartedAt = performance.now()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, width * height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1
    const entry: TextureEntry = { key, texture, width, height, bytes, lastUsed: this._time }
    this._textures.set(key, entry)
    this.evictTexturesIfNeeded()
    return entry
  }

  /**
   * Выполняет внутреннюю операцию rasterize text.
   */
  private rasterizeText(text: NovaText, style: NovaCompiledTextStyle, scale: number): RasterizedText {
    const canvas = this._textRasterCanvas
    const width = Math.max(1, Math.ceil(text.width * scale))
    const height = Math.max(1, Math.ceil(text.height * scale))
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return { canvas, width, height, scale }

    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, text.width, text.height)
    ctx.font = style.font
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = colorToCss(style.color)

    const contentWidth = Math.max(0, text.width - style.padding.left - style.padding.right)
    const contentHeight = Math.max(0, text.height - style.padding.top - style.padding.bottom)
    const renderedText = style.ellipsis ? ellipsizeText(ctx, text.text, contentWidth) : text.text
    const metrics = ctx.measureText(renderedText)
    let x = text.x * 0
    if (style.horizontalAlign === 'left') x = style.padding.left
    if (style.horizontalAlign === 'center') x = style.padding.left + (contentWidth - metrics.width) / 2
    if (style.horizontalAlign === 'right') x = text.width - style.padding.right - metrics.width

    const textHeight = style.lineHeight
    let y = style.padding.top + style.fontSize
    if (style.verticalAlign === 'middle') y = style.padding.top + (contentHeight - textHeight) / 2 + style.fontSize
    if (style.verticalAlign === 'bottom') y = text.height - style.padding.bottom - textHeight + style.fontSize

    ctx.fillText(renderedText, x, y, contentWidth)
    return { canvas, width, height, scale }
  }

  /**
   * Создает text key.
   */
  private createTextKey(text: NovaText, style: NovaCompiledTextStyle, scale: number): string {
    return [
      'text',
      scale,
      this.createTextBaseKey(text, style),
    ].join(':')
  }

  /**
   * Создает text key без raster scale для fallback между buckets.
   */
  private createTextBaseKey(text: NovaText, style: NovaCompiledTextStyle): string {
    return [
      text.text,
      text.width,
      text.height,
      style.font,
      style.lineHeight,
      colorToCss(style.color),
      style.padding.left,
      style.padding.right,
      style.padding.top,
      style.padding.bottom,
      style.horizontalAlign,
      style.verticalAlign,
      style.ellipsis,
    ].join(':')
  }

  /**
   * Вычисляет source key.
   */
  private resolveSourceKey(source: CanvasImageSource): string {
    if (typeof source !== 'object' || source === null) return 'source'
    const existing = this._sourceTextureKeys.get(source)
    if (existing) return existing
    const next = `source:${this._sourceTextureKeysSize()}`
    this._sourceTextureKeys.set(source, next)
    return next
  }

  /**
   * Выполняет внутреннюю операцию source texture keys size.
   */
  private _sourceTextureKeysSize(): number {
    return this._textures.size + 1
  }

  /**
   * Вычисляет border sides.
   */
  private resolveBorderSides(position: NovaBorder['position']): Array<'left' | 'right' | 'top' | 'bottom'> {
    if (position === 'vertical') return ['left', 'right']
    if (position === 'horizontal') return ['top', 'bottom']
    if (Array.isArray(position)) return position
    return ['left', 'right', 'top', 'bottom']
  }

  /**
   * Обновляет scissor.
   */
  private setScissor(clip: NovaRenderClip | null, transform: mat3): void {
    const gl = this._gl
    if (!clip) {
      gl.disable(gl.SCISSOR_TEST)
      return
    }

    const bounds = transformRectBounds(transform, clip.x, clip.y, clip.width, clip.height)
    const dpr = this._device.canvas.dpr
    const x = Math.max(0, Math.floor(bounds.x * dpr))
    const y = Math.max(0, Math.floor(this._device.canvas.pixelHeight - (bounds.y + bounds.height) * dpr))
    const width = Math.max(0, Math.ceil(bounds.width * dpr))
    const height = Math.max(0, Math.ceil(bounds.height * dpr))
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(x, y, width, height)
  }

  /**
   * Выполняет внутреннюю операцию texture memory mb.
   */
  private textureMemoryMB(): number {
    let bytes = 0
    for (const texture of this._textures.values()) bytes += texture.bytes
    bytes += this.textAtlasMemoryBytes()
    return bytes / 1024 / 1024
  }

  /**
   * Возвращает memory bytes text atlas pages.
   */
  private textAtlasMemoryBytes(): number {
    let bytes = 0
    for (const page of this._textAtlasPages) bytes += page.texture.bytes
    return bytes
  }

  /**
   * Освобождает все text atlas pages.
   */
  private destroyTextAtlas(): void {
    for (const page of this._textAtlasPages) {
      this._gl.deleteTexture(page.texture.texture)
    }
    this._textAtlasPages.length = 0
    this._textAtlasEntries.clear()
    this._textFallbackKeys.clear()
  }

  /**
   * Выполняет внутреннюю операцию evict textures if needed.
   */
  private evictTexturesIfNeeded(): void {
    const maxBytes = 128 * 1024 * 1024
    let bytes = 0
    for (const texture of this._textures.values()) bytes += texture.bytes
    if (bytes <= maxBytes) return

    const entries = [...this._textures.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const entry of entries) {
      if (bytes <= maxBytes * FULL_UPLOAD_DIRTY_RATIO) break
      this._gl.deleteTexture(entry.texture)
      this._textures.delete(entry.key)
      bytes -= entry.bytes
    }
  }
}

/**
 * Выполняет внутреннюю операцию transform point.
 */
function transformPoint(matrix: mat3, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[3] * y + matrix[6],
    y: matrix[1] * x + matrix[4] * y + matrix[7],
  }
}

/**
 * Выполняет внутреннюю операцию mat3 equals.
 */
function mat3Equals(a: mat3, b: mat3): boolean {
  for (let i = 0; i < 9; i += 1) {
    if (Math.abs(a[i] - b[i]) > 0.0001) return false
  }
  return true
}

/**
 * Объединяет float dirty ranges.
 */
function mergeFloatDirtyRanges(ranges: Array<FloatDirtyRange>): Array<FloatDirtyRange> {
  if (ranges.length <= 1) return ranges

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<FloatDirtyRange> = []
  let current = { ...sorted[0] }

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index]
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end)
      continue
    }

    merged.push(current)
    current = { ...next }
  }

  merged.push(current)
  return merged
}

/**
 * Выполняет внутреннюю операцию transform rect bounds.
 */
function transformRectBounds(matrix: mat3, x: number, y: number, width: number, height: number): NovaRenderClip {
  const p1 = transformPoint(matrix, x, y)
  const p2 = transformPoint(matrix, x + width, y)
  const p3 = transformPoint(matrix, x, y + height)
  const p4 = transformPoint(matrix, x + width, y + height)
  const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Выполняет внутреннюю операцию color to css.
 */
function resolveAnimationVector(meta?: NovaShaderRenderMeta | null): ResolvedShaderAnimation {
  const animation = meta?.animation
  if (!animation) return EMPTY_SHADER_ANIMATION

  return {
    phase: Number.isFinite(animation.phase) ? animation.phase! : 0,
    speed: Number.isFinite(animation.speed) ? animation.speed! : 0.08,
    amplitude: Math.max(0, Math.min(1, Number.isFinite(animation.amplitude) ? animation.amplitude! : 0.18)),
  }
}

/**
 * Нормализует metadata shader movement.
 */
function resolveMotionVector(meta?: NovaShaderRenderMeta | null): ResolvedShaderMotion {
  const motion = meta?.motion
  if (!motion) return EMPTY_SHADER_MOTION
  const speed = Number.isFinite(motion.speed) ? motion.speed! : 0
  const wrapWidth = Number.isFinite(motion.wrapWidth) ? motion.wrapWidth! : 0

  return {
    speed,
    wrapWidth: Math.max(0, wrapWidth),
  }
}

/**
 * Выполняет внутреннюю операцию color to css.
 */
function colorToCss(color: NovaParsedColor): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`
}

/**
 * Выполняет внутреннюю операцию ellipsize text.
 */
function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  const suffix = '...'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}${suffix}`).width <= width) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo)}${suffix}`
}

/**
 * Вычисляет source width.
 */
function resolveSourceWidth(source: CanvasImageSource): number {
  if ('naturalWidth' in source && typeof source.naturalWidth === 'number') return source.naturalWidth
  if ('videoWidth' in source && typeof source.videoWidth === 'number') return source.videoWidth
  return 'width' in source && typeof source.width === 'number' ? source.width : 1
}

/**
 * Вычисляет source height.
 */
function resolveSourceHeight(source: CanvasImageSource): number {
  if ('naturalHeight' in source && typeof source.naturalHeight === 'number') return source.naturalHeight
  if ('videoHeight' in source && typeof source.videoHeight === 'number') return source.videoHeight
  return 'height' in source && typeof source.height === 'number' ? source.height : 1
}

const ROUNDED_RECT_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_position;
in vec2 a_local;
in vec2 a_size;
in float a_radius;
in vec4 a_fill;
in vec4 a_border;
in float a_borderWidth;
in vec3 a_animation;
in vec2 a_motion;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform float u_time;
out vec2 v_local;
out vec2 v_size;
out float v_radius;
out vec4 v_fill;
out vec4 v_border;
out float v_borderWidth;
out vec3 v_animation;
void main() {
  vec2 position = a_position;
  if (a_motion.y > 0.0 && a_motion.x != 0.0) {
    float left = a_position.x - a_local.x;
    float movedLeft = mod(left - u_time * a_motion.x + a_motion.y, a_motion.y) - a_size.x;
    position.x = movedLeft + a_local.x;
  }
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_local = a_local;
  v_size = a_size;
  v_radius = a_radius;
  v_fill = a_fill;
  v_border = a_border;
  v_borderWidth = a_borderWidth;
  v_animation = a_animation;
}
`

const ROUNDED_RECT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec2 v_size;
in float v_radius;
in vec4 v_fill;
in vec4 v_border;
in float v_borderWidth;
in vec3 v_animation;
uniform float u_time;
out vec4 outColor;
float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p - halfSize) - (halfSize - vec2(radius));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
  float radius = min(v_radius, min(v_size.x, v_size.y) * 0.5);
  float dist = radius <= 0.0
    ? max(max(-v_local.x, v_local.x - v_size.x), max(-v_local.y, v_local.y - v_size.y))
    : sdRoundRect(v_local, v_size * 0.5, radius);
  float aa = max(fwidth(dist), 0.001);
  float shapeAlpha = 1.0 - smoothstep(-aa, aa, dist);
  float borderMask = 0.0;
  if (v_borderWidth > 0.0 && v_border.a > 0.0) {
    borderMask = smoothstep(-v_borderWidth - aa, -v_borderWidth + aa, dist);
  }
  vec4 color = mix(v_fill, v_border, borderMask);
  if (v_animation.z > 0.0) {
    float pulse = 0.5 + 0.5 * sin(u_time * v_animation.y + v_animation.x);
    color.rgb = mix(color.rgb, min(color.rgb * 1.35 + vec3(0.08), vec3(1.0)), pulse * v_animation.z);
  }
  outColor = vec4(color.rgb, color.a * shapeAlpha);
}
`

const SOLID_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_position;
in vec4 a_color;
in vec3 a_animation;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform float u_time;
out vec4 v_color;
out vec3 v_animation;
void main() {
  vec3 world = u_transform * vec3(a_position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
  v_animation = a_animation;
}
`

const SOLID_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec3 v_animation;
uniform float u_time;
out vec4 outColor;
void main() {
  vec4 color = v_color;
  if (v_animation.z > 0.0) {
    float pulse = 0.5 + 0.5 * sin(u_time * v_animation.y + v_animation.x);
    color.rgb = mix(color.rgb, min(color.rgb * 1.35 + vec3(0.08), vec3(1.0)), pulse * v_animation.z);
  }
  outColor = color;
}
`

const TEXTURE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec3 world = u_transform * vec3(a_position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
`

const TEXTURE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_uv) * v_color;
}
`

const RECT_BATCH_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec4 a_rect;
in vec4 a_color;
in float a_state;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec4 v_color;
flat out float v_state;
void main() {
  vec2 uv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = a_rect.xy + uv * a_rect.zw;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
  v_state = a_state;
}
`

const RECT_BATCH_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
flat in float v_state;
out vec4 outColor;
void main() {
  vec4 color = v_color;
  if (v_state > 0.5) {
    color.rgb = min(color.rgb * 1.08 + vec3(0.03), vec3(1.0));
  }
  outColor = color;
}
`

const PARTICLE_CIRCLE_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec2 a_center;
in float a_radius;
in vec4 a_fill;
in vec4 a_stroke;
in float a_strokeWidth;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_local;
out float v_radius;
out vec4 v_fill;
out vec4 v_stroke;
out float v_strokeWidth;
void main() {
  vec2 local = a_unit * a_radius;
  vec2 position = a_center + local;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_local = local;
  v_radius = a_radius;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_strokeWidth = a_strokeWidth;
}
`

const PARTICLE_CIRCLE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_local;
in float v_radius;
in vec4 v_fill;
in vec4 v_stroke;
in float v_strokeWidth;
out vec4 outColor;
void main() {
  float dist = length(v_local) - v_radius;
  float aa = max(fwidth(dist), 0.001);
  float shapeAlpha = 1.0 - smoothstep(-aa, aa, dist);
  float inner = v_strokeWidth > 0.0
    ? 1.0 - smoothstep(-v_strokeWidth - aa, -v_strokeWidth + aa, dist)
    : 1.0;
  float strokeMask = clamp(1.0 - inner, 0.0, 1.0);
  vec4 color = mix(v_fill, v_stroke, strokeMask);
  outColor = vec4(color.rgb, color.a * shapeAlpha);
}
`

const PARTICLE_SPRITE_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec2 a_position;
in float a_size;
in float a_opacity;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_uv;
out float v_opacity;
void main() {
  vec2 uv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = a_position + uv * a_size;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = uv;
  v_opacity = a_opacity;
}
`

const PARTICLE_SPRITE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in float v_opacity;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_uv) * vec4(1.0, 1.0, 1.0, v_opacity);
}
`

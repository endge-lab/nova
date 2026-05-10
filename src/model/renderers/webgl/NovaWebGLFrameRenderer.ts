import { mat3 } from 'gl-matrix'
import type { NovaRenderClip, NovaRenderFrame, NovaRenderItem, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type {
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaPolygon,
  NovaRect,
  NovaSchemaItem,
  NovaSemanticScopeKind,
  NovaText,
} from '@/domain/types/renderer-types'
import { NovaGraphics } from '@/model/renderers/shared/NovaGraphics'
import type { NovaWebGLDevice } from '@/model/renderers/webgl/NovaWebGLDevice'
import { NovaGpuBufferArena } from '@/model/renderers/webgl/NovaGpuBufferArena'
import { NovaWebGLProgram } from '@/model/renderers/webgl/NovaWebGLProgram'
import type { NovaParsedColor } from '@/model/rendering/schema/NovaColorParser'
import {
  compileNovaBorderStyle,
  compileNovaCircleStyle,
  compileNovaLineStyle,
  compileNovaPolygonStyle,
  compileNovaRectStyle,
  compileNovaTextStyle,
  type NovaCompiledTextStyle,
} from '@/model/rendering/schema/NovaStyleCompiler'

const FLOAT_BYTES = 4
const RECT_STRIDE = 16
const SOLID_STRIDE = 6
const TEXTURE_STRIDE = 8
const FULL_UPLOAD_DIRTY_RATIO = 0.6
const TEXT_RASTER_ZOOM_BUCKETS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 8, 16]

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
  atlasMemoryMB: number
}

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
  itemOffsets: number[]
  signatures: string[]
  contentVersion?: number
}

/**
 * Описывает контракт TextureBatchCache.
 */
interface TextureBatchCache {
  data: Float32Array
  instances: number
  itemOffsets: number[]
  signatures: string[]
  texture: TextureEntry
  upload: WebGLUploadState
  contentVersion?: number
  rasterScale?: number
  buffer?: WebGLBuffer
  vao?: WebGLVertexArrayObject
}

/**
 * Описывает контракт NonOverlapLayeredBatchCache.
 */
interface NonOverlapLayeredBatchCache {
  rects: NovaSchemaItem<any>[]
  icons: NovaSchemaItem<any>[]
  texts: NovaSchemaItem<any>[]
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
  dirtyRanges: FloatDirtyRange[]
  changedItems: number
}

/**
 * Описывает контракт TextureBatchUpdate.
 */
interface TextureBatchUpdate {
  dirtyRanges: FloatDirtyRange[]
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
}

/**
 * Преобразует Nova render frame в WebGL draw calls и GPU uploads.
 */
export class NovaWebGLFrameRenderer {
  private readonly _gl: WebGL2RenderingContext
  private readonly _roundedProgram: NovaWebGLProgram
  private readonly _solidProgram: NovaWebGLProgram
  private readonly _textureProgram: NovaWebGLProgram
  private readonly _roundedBuffer: WebGLBuffer
  private readonly _solidBuffer: WebGLBuffer
  private readonly _textureBuffer: WebGLBuffer
  private readonly _roundedVao: WebGLVertexArrayObject
  private readonly _solidVao: WebGLVertexArrayObject
  private readonly _textureVao: WebGLVertexArrayObject
  private readonly _measureCanvas = document.createElement('canvas')
  private readonly _textRasterCanvas = document.createElement('canvas')
  private readonly _textures = new Map<string, TextureEntry>()
  private readonly _sourceTextureKeys = new WeakMap<object, string>()
  private readonly _plainRectBatchCache = new WeakMap<NovaSchemaItem<any>[], RectBatchCache>()
  private readonly _rectBatchCache = new WeakMap<NovaSchemaItem<any>[], RectBatchCache>()
  private readonly _textureBatchCache = new WeakMap<NovaSchemaItem<any>[], TextureBatchCache>()
  private readonly _semanticBatchCache = new WeakMap<NovaSchemaItem<any>[], NonOverlapLayeredBatchCache>()
  private readonly _ownedTextureBatchCaches = new Set<TextureBatchCache>()
  private readonly _roundedUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _solidUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _textureUpload: WebGLUploadState = createWebGLUploadState()

  private _rectData: number[] = []
  private _rectCachedData: Float32Array | null = null
  private _rectCachedDirtyRanges: FloatDirtyRange[] | null = null
  private _solidData: number[] = []
  private _solidCachedData: Float32Array | null = null
  private _solidCachedDirtyRanges: FloatDirtyRange[] | null = null
  private _textureData: number[] = []
  private _textureBatch: TextureEntry | null = null
  private _textureCachedData: Float32Array | null = null
  private _textureCachedDirtyRanges: FloatDirtyRange[] | null = null
  private _textureCachedBatch: TextureBatchCache | null = null
  private _roundedTransform = mat3.create()
  private _solidTransform = mat3.create()
  private _textureTransform = mat3.create()
  private _time = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(private readonly _device: NovaWebGLDevice) {
    this._gl = _device.gl
    this._roundedProgram = NovaWebGLProgram.create(this._gl, ROUNDED_RECT_VERTEX_SHADER, ROUNDED_RECT_FRAGMENT_SHADER)
    this._solidProgram = NovaWebGLProgram.create(this._gl, SOLID_VERTEX_SHADER, SOLID_FRAGMENT_SHADER)
    this._textureProgram = NovaWebGLProgram.create(this._gl, TEXTURE_VERTEX_SHADER, TEXTURE_FRAGMENT_SHADER)
    this._roundedBuffer = this.createBuffer()
    this._solidBuffer = this.createBuffer()
    this._textureBuffer = this.createBuffer()
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
      atlasMemoryMB: this.textureMemoryMB(),
    }
    const itemMap = frame.items.length > 0 ? new Map(frame.items.map(item => [item.id, item])) : null
    const identity = mat3.create()
    let currentTransform = identity
    const transformStack: mat3[] = []
    const clipStack: NovaRenderClip[] = []

    this._time += 1
    this._device.resize()
    this._device.clear()
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
      atlasMemoryMB: this.textureMemoryMB(),
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
    for (const cache of this._ownedTextureBatchCaches) {
      if (cache.buffer) this._gl.deleteBuffer(cache.buffer)
      if (cache.vao) this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedTextureBatchCaches.clear()
    this._gl.deleteBuffer(this._roundedBuffer)
    this._gl.deleteBuffer(this._solidBuffer)
    this._gl.deleteBuffer(this._textureBuffer)
    this._gl.deleteVertexArray(this._roundedVao)
    this._gl.deleteVertexArray(this._solidVao)
    this._gl.deleteVertexArray(this._textureVao)
    this._roundedProgram.destroy()
    this._solidProgram.destroy()
    this._textureProgram.destroy()
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
  private resolveSchemaContentVersion(items: NovaSchemaItem<any>[] | undefined, fallback: number | undefined): number | undefined {
    return (items as { contentVersion?: number } | undefined)?.contentVersion ?? fallback
  }

  /**
   * Выполняет внутреннюю операцию draw schema batch.
   */
  private drawSchemaBatch(
    items: NovaSchemaItem<any>[],
    transform: mat3,
    stats: RenderStats,
    semanticScope?: NovaSemanticScopeKind,
    contentVersion?: number,
  ): boolean {
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
    let dirtyRanges: FloatDirtyRange[] | null = null
    let changedItems = 0
    if (!batch) {
      const nextBatch = this.buildRectBatch(items)
      if (!nextBatch) return false
      nextBatch.contentVersion = contentVersion
      batch = nextBatch
      this._rectBatchCache.set(items, nextBatch)
    } else if (contentVersion === undefined || batch.contentVersion !== contentVersion) {
      const update = this.updateRectBatch(items, batch)
      if (!update) {
        const nextBatch = this.buildRectBatch(items)
        if (!nextBatch) return false
        nextBatch.contentVersion = contentVersion
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
  private drawPlainRectSchemaBatch(items: NovaSchemaItem<any>[], transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    let batch = this._plainRectBatchCache.get(items)
    let dirtyRanges: FloatDirtyRange[] | null = null
    let changedItems = 0

    if (!batch) {
      batch = this.buildPlainRectBatch(items)
      batch.contentVersion = contentVersion
      this._plainRectBatchCache.set(items, batch)
    } else if (contentVersion === undefined || batch.contentVersion !== contentVersion) {
      const update = this.updatePlainRectBatch(items, batch)
      if (!update) {
        batch = this.buildPlainRectBatch(items)
        batch.contentVersion = contentVersion
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
  private drawNonOverlapLayeredSchemaBatch(items: NovaSchemaItem<any>[], transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    if (items.length === 0) return true

    const batch = this.resolveNonOverlapLayeredBatch(items)
    if (!batch) return false

    if (batch.rects.length > 0 && !this.drawSchemaBatch(batch.rects, transform, stats, undefined, contentVersion)) return false

    if (batch.icons.length > 0 && !this.drawTextureSchemaBatch(batch.icons, transform, stats, contentVersion)) return false

    if (batch.texts.length > 0 && !this.drawTextureSchemaBatch(batch.texts, transform, stats, contentVersion)) return false

    return true
  }

  /**
   * Вычисляет non overlap layered batch.
   */
  private resolveNonOverlapLayeredBatch(items: NovaSchemaItem<any>[]): NonOverlapLayeredBatchCache | null {
    const cached = this._semanticBatchCache.get(items)
    if (cached) return cached

    const rects: NovaSchemaItem<any>[] = []
    const icons: NovaSchemaItem<any>[] = []
    const texts: NovaSchemaItem<any>[] = []

    for (const item of items) {
      if (item.active === false) continue
      if (item.clip !== undefined && item.clip !== true) return null

      if (item.type === 'rect') {
        rects.push(item)
        continue
      }

      if (item.type === 'icon') {
        icons.push(item)
        continue
      }

      if (item.type === 'text') {
        texts.push(item)
        continue
      }

      return null
    }

    const batch = { rects, icons, texts }
    this._semanticBatchCache.set(items, batch)
    return batch
  }

  /**
   * Выполняет внутреннюю операцию build rect batch.
   */
  private buildRectBatch(items: NovaSchemaItem<any>[]): RectBatchCache | null {
    const data: number[] = []
    const itemOffsets: number[] = new Array(items.length).fill(-1)
    const signatures: string[] = new Array(items.length).fill('')
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      signatures[index] = this.createRectSignature(rect)
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
  private buildPlainRectBatch(items: NovaSchemaItem<any>[]): RectBatchCache {
    const data: number[] = []
    const itemOffsets: number[] = new Array(items.length).fill(-1)
    const signatures: string[] = new Array(items.length).fill('')
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      signatures[index] = this.createRectSignature(rect)
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0 || style.fill.a <= 0) continue

      itemOffsets[index] = data.length
      this.pushSolidRectVertices(data, rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity)
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
  private updateRectBatch(items: NovaSchemaItem<any>[], batch: RectBatchCache): RectBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) return null

    const dirtyRanges: FloatDirtyRange[] = []
    let changedItems = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      const signature = this.createRectSignature(rect)
      if (signature === batch.signatures[index]) continue

      const offset = batch.itemOffsets[index]
      if (offset < 0) return null
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
  private updatePlainRectBatch(items: NovaSchemaItem<any>[], batch: RectBatchCache): RectBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) {
      return null
    }

    const dirtyRanges: FloatDirtyRange[] = []
    let changedItems = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      const signature = this.createRectSignature(rect)
      if (signature === batch.signatures[index]) continue

      const offset = batch.itemOffsets[index]
      if (offset < 0) return null

      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0 || style.fill.a <= 0) return null
      this.writeSolidRectVertices(batch.data, offset, rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity)
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
  private drawTextureSchemaBatch(items: NovaSchemaItem<any>[], transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    if (items.length === 0) return true

    let batch: TextureBatchCache | null = this._textureBatchCache.get(items) ?? null
    let dirtyRanges: FloatDirtyRange[] | null = null
    let changedItems = 0
    const rasterScale = this.resolveTextureRasterScale(items, transform)

    if (!batch) {
      batch = this.buildTextureBatch(items, stats, rasterScale)
      if (!batch) return false
      batch.contentVersion = contentVersion
      batch.rasterScale = rasterScale
      this._textureBatchCache.set(items, batch)
      this._ownedTextureBatchCaches.add(batch)
    } else if (contentVersion === undefined || batch.contentVersion !== contentVersion || batch.rasterScale !== rasterScale) {
      const update = this.updateTextureBatch(items, batch, stats, rasterScale)
      if (!update) {
        batch = this.buildTextureBatch(items, stats, rasterScale)
        if (!batch) return false
        batch.contentVersion = contentVersion
        batch.rasterScale = rasterScale
        this._textureBatchCache.set(items, batch)
        this._ownedTextureBatchCaches.add(batch)
      } else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
        batch.rasterScale = rasterScale
      }
    }

    if (batch.data.length === 0) return true

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
  private buildTextureBatch(items: NovaSchemaItem<any>[], stats: RenderStats, rasterScale?: number): TextureBatchCache | null {
    const data: number[] = []
    const itemOffsets: number[] = new Array(items.length).fill(-1)
    const signatures: string[] = new Array(items.length).fill('')
    let texture: TextureEntry | null = null
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const item = this.resolveTextureBatchItem(items[index], stats, rasterScale)
      if (!item) return null
      if (texture && texture !== item.texture) return null

      texture = item.texture
      signatures[index] = item.signature
      if (item.width <= 0 || item.height <= 0 || item.opacity <= 0) continue

      itemOffsets[index] = data.length
      this.pushTextureQuadVertices(data, item.x, item.y, item.width, item.height, item.opacity)
      instances += 1
    }

    if (!texture) return null

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
  private updateTextureBatch(items: NovaSchemaItem<any>[], batch: TextureBatchCache, stats: RenderStats, rasterScale?: number): TextureBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) return null

    const dirtyRanges: FloatDirtyRange[] = []
    let changedItems = 0

    for (let index = 0; index < items.length; index += 1) {
      const item = this.resolveTextureBatchItem(items[index], stats, rasterScale)
      if (!item || item.texture !== batch.texture) return null
      if (item.signature === batch.signatures[index]) continue

      const offset = batch.itemOffsets[index]
      if (offset < 0) return null
      if (item.width <= 0 || item.height <= 0 || item.opacity <= 0) return null

      this.writeTextureQuadVertices(batch.data, offset, item.x, item.y, item.width, item.height, item.opacity)
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
  private resolveTextureBatchItem(item: NovaSchemaItem<any>, stats: RenderStats, rasterScale?: number): TextureBatchItem | null {
    if (item.active === false) return null

    if (item.type === 'icon') {
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
      }
    }

    if (item.type === 'text') {
      const style = compileNovaTextStyle(item)
      const scale = rasterScale ?? this._device.canvas.dpr
      const key = this.createTextKey(item, style, scale)
      let texture = this._textures.get(key)
      if (!texture) {
        const rasterStartedAt = performance.now()
        const raster = this.rasterizeText(item, style, scale)
        stats.textRasterMs += performance.now() - rasterStartedAt
        texture = this.createTextureFromSource(key, raster.canvas, stats)
      }

      texture.lastUsed = this._time
      return {
        texture,
        signature: [key, item.x, item.y, item.width, item.height, style.opacity].join('|'),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        opacity: style.opacity,
      }
    }

    return null
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
    ].join('|')
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
        this.queuePlainRect(rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, transform, stats)
        return
      }
      this.queueRoundedRect(rect.x, rect.y, rect.width, rect.height, style.borderRadius, style.fill, style.opacity, style.borderColor, style.borderWidth, transform, stats)
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
    const style = compileNovaTextStyle(text)
    const scale = this.resolveTextRasterScale(transform)
    const key = this.createTextKey(text, style, scale)
    let texture = this._textures.get(key)

    if (!texture) {
      const rasterStartedAt = performance.now()
      const raster = this.rasterizeText(text, style, scale)
      stats.textRasterMs += performance.now() - rasterStartedAt
      texture = this.createTextureFromSource(key, raster.canvas, stats)
    }

    texture.lastUsed = this._time
    this.queueTextureQuad(texture, text.x, text.y, text.width, text.height, transform, style.opacity, stats)
  }

  /**
   * Вычисляет texture raster scale.
   */
  private resolveTextureRasterScale(items: NovaSchemaItem<any>[], transform: mat3): number | undefined {
    return items.some(item => item.type === 'text') ? this.resolveTextRasterScale(transform) : undefined
  }

  /**
   * Вычисляет text raster scale.
   */
  private resolveTextRasterScale(transform: mat3): number {
    const scaleX = Math.hypot(transform[0], transform[1])
    const scaleY = Math.hypot(transform[3], transform[4])
    const zoom = Math.max(0.01, scaleX, scaleY)
    let best = TEXT_RASTER_ZOOM_BUCKETS[0]
    let bestDistance = Math.abs(zoom - best)

    for (const bucket of TEXT_RASTER_ZOOM_BUCKETS) {
      const distance = Math.abs(zoom - bucket)
      if (distance < bestDistance) {
        best = bucket
        bestDistance = distance
      }
    }

    return this._device.canvas.dpr * best
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
  ): void {
    if (width <= 0 || height <= 0) return
    if (fill.a <= 0 && (border.a <= 0 || borderWidth <= 0)) return
    this.flushTexture(stats)
    this.flushSolid(stats)
    this.prepareRoundedTransform(transform, stats)

    this.pushRoundedRectVertices(this._rectData, x, y, width, height, radius, fill, opacity, border, borderWidth)
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
  ): void {
    if (width <= 0 || height <= 0 || fill.a <= 0) return
    this.flushTexture(stats)
    this.flushRounded(stats)
    this.prepareSolidTransform(transform, stats)

    this.pushSolidRectVertices(this._solidData, x, y, width, height, fill, opacity)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию push rounded rect vertices.
   */
  private pushRoundedRectVertices(
    target: number[],
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
  ): void {
    const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
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
  ): void {
    const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
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
    }
  }

  /**
   * Выполняет внутреннюю операцию push solid rect vertices.
   */
  private pushSolidRectVertices(target: number[], x: number, y: number, width: number, height: number, fill: NovaParsedColor, opacity: number): void {
    this.pushSolidVertexTo(target, x, y, fill, opacity)
    this.pushSolidVertexTo(target, x + width, y, fill, opacity)
    this.pushSolidVertexTo(target, x, y + height, fill, opacity)
    this.pushSolidVertexTo(target, x, y + height, fill, opacity)
    this.pushSolidVertexTo(target, x + width, y, fill, opacity)
    this.pushSolidVertexTo(target, x + width, y + height, fill, opacity)
  }

  /**
   * Записывает solid rect vertices.
   */
  private writeSolidRectVertices(target: Float32Array, offset: number, x: number, y: number, width: number, height: number, fill: NovaParsedColor, opacity: number): void {
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
    dashPattern?: number[],
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
    dashPattern: number[],
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
  private queueTextureQuad(texture: TextureEntry, x: number, y: number, width: number, height: number, transform: mat3, opacity: number, stats: RenderStats): void {
    if (width <= 0 || height <= 0 || opacity <= 0) return
    this.flushRounded(stats)
    this.flushSolid(stats)
    this.prepareTextureTransform(transform, stats)

    if (this._textureCachedData) this.flushTexture(stats)
    if (this._textureBatch && this._textureBatch !== texture) this.flushTexture(stats)
    this._textureBatch = texture

    this.pushTextureQuadVertices(this._textureData, x, y, width, height, opacity)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию push texture quad vertices.
   */
  private pushTextureQuadVertices(target: number[], x: number, y: number, width: number, height: number, opacity: number): void {
    const vertices = [
      [x, y, 0, 0],
      [x + width, y, 1, 0],
      [x, y + height, 0, 1],
      [x, y + height, 0, 1],
      [x + width, y, 1, 0],
      [x + width, y + height, 1, 1],
    ]

    for (const [px, py, u, v] of vertices) {
      target.push(px, py, u, v, 1, 1, 1, opacity)
    }
  }

  /**
   * Записывает texture quad vertices.
   */
  private writeTextureQuadVertices(target: Float32Array, offset: number, x: number, y: number, width: number, height: number, opacity: number): void {
    const vertices = [
      [x, y, 0, 0],
      [x + width, y, 1, 0],
      [x, y + height, 0, 1],
      [x, y + height, 0, 1],
      [x + width, y, 1, 0],
      [x + width, y + height, 1, 1],
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
    this._solidData.push(x, y, color.r, color.g, color.b, color.a * opacity)
  }

  /**
   * Выполняет внутреннюю операцию push solid vertex to.
   */
  private pushSolidVertexTo(target: number[], x: number, y: number, color: NovaParsedColor, opacity: number): void {
    target.push(x, y, color.r, color.g, color.b, color.a * opacity)
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
    if (!texture) return

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
  private uploadArrayBuffer(data: Float32Array, state: WebGLUploadState, stats: RenderStats, dirtyRanges: FloatDirtyRange[] | null = null): void {
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
    return bytes / 1024 / 1024
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
function mergeFloatDirtyRanges(ranges: FloatDirtyRange[]): FloatDirtyRange[] {
  if (ranges.length <= 1) return ranges

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: FloatDirtyRange[] = []
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
in vec2 a_position;
in vec2 a_local;
in vec2 a_size;
in float a_radius;
in vec4 a_fill;
in vec4 a_border;
in float a_borderWidth;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_local;
out vec2 v_size;
out float v_radius;
out vec4 v_fill;
out vec4 v_border;
out float v_borderWidth;
void main() {
  vec3 world = u_transform * vec3(a_position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_local = a_local;
  v_size = a_size;
  v_radius = a_radius;
  v_fill = a_fill;
  v_border = a_border;
  v_borderWidth = a_borderWidth;
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
  outColor = vec4(color.rgb, color.a * shapeAlpha);
}
`

const SOLID_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec4 v_color;
void main() {
  vec3 world = u_transform * vec3(a_position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
}
`

const SOLID_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
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

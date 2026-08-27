import type { NovaCanvasCreateOptions, NovaCanvasOwnership, NovaSizeOptions } from '@/domain/types/base.types'
import type {
  NovaExportFormat,
  NovaExportImageOptions,
  NovaExportImageResult,
} from '@/domain/types/export.types'
import { NovaExportError } from '@/domain/types/export.types'
import { RendererType } from '@/domain/types/renderer.types'
import { Telemetry } from '@/model/telemetry.ts'

const CANVAS_2D_CONTEXT_TYPE = '2d'
const EXPORT_MIME_BY_FORMAT: Record<NovaExportFormat, string> = {
  png: 'image/png',
  webp: 'image/webp',
}

/**
 * Оборачивает HTMLCanvasElement и управляет context, DPR и ownership.
 */
export class NovaCanvas {
  private readonly _element: HTMLCanvasElement
  private readonly _ownership: NovaCanvasOwnership

  private _ctx2D?: CanvasRenderingContext2D
  private _cachedRect?: DOMRectReadOnly
  private _dpr = 1
  private _maxDpr = 2
  private _webglAttributes?: WebGLContextAttributes

  private _handlersInited = false
  private _destroyed = false

  private _glId?: string

  private _isContextLost = false
  private _onContextLostCallback?: () => void
  private _onContextRestoredCallback?: () => void

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  private constructor(canvas: HTMLCanvasElement, ownership: NovaCanvasOwnership, options: NovaCanvasCreateOptions = {}) {
    this._element = canvas
    this._ownership = ownership
    this._dpr = this._resolveDpr(options.dpr, options.maxDpr)
    this._maxDpr = options.maxDpr ?? 2
    this._webglAttributes = options.webgl
  }

  /**
   * Возвращает element.
   */
  get element(): HTMLCanvasElement {
    return this._element
  }

  /**
   * Возвращает width.
   */
  get width(): number {
    return this._element.width / this._dpr
  }

  /**
   * Возвращает height.
   */
  get height(): number {
    return this._element.height / this._dpr
  }

  /**
   * Возвращает pixel width.
   */
  get pixelWidth(): number {
    return this._element.width
  }

  /**
   * Возвращает pixel height.
   */
  get pixelHeight(): number {
    return this._element.height
  }

  /**
   * Возвращает dpr.
   */
  get dpr(): number {
    return this._dpr
  }

  /**
   * Возвращает max dpr.
   */
  get maxDpr(): number {
    return this._maxDpr
  }

  /**
   * Возвращает webgl attributes.
   */
  get webglAttributes(): WebGLContextAttributes | undefined {
    return this._webglAttributes
  }

  /**
   * Возвращает bounding client rect.
   */
  getBoundingClientRect(): DOMRectReadOnly {
    if (!this._cachedRect) {
      this._cachedRect = this._element.getBoundingClientRect()
    }
    return this._cachedRect
  }

  /**
   * Выполняет внутреннюю операцию invalidate.
   */
  invalidate(): void {
    this._cachedRect = undefined
  }

  /**
   * Выполняет внутреннюю операцию resize.
   */
  resize(width: number, height: number, options: Partial<NovaSizeOptions> = {}): void {
    this._cachedRect = undefined

    this._maxDpr = options.maxDpr ?? this._maxDpr
    this._dpr = this._resolveDpr(options.dpr, this._maxDpr)
    const dpr = this._dpr

    this._element.width = Math.max(0, Math.floor(width * dpr))
    this._element.height = Math.max(0, Math.floor(height * dpr))
    this._element.style.width = `${width}px`
    this._element.style.height = `${height}px`

    if (this._glId) {
      Telemetry.event('canvas:resize', { w: width, h: height, dpr }, undefined, this._glId)
    }

    if (this._ctx2D) {
      this._ctx2D.setTransform(1, 0, 0, 1, 0, 0)
      this._ctx2D.scale(this._dpr, this._dpr)
      this._ctx2D.imageSmoothingEnabled = false
    }
  }

  /**
   * Возвращает context2 d.
   */
  getContext2D(): CanvasRenderingContext2D {
    if (!this._ctx2D) {
      const ctx = this._element.getContext(CANVAS_2D_CONTEXT_TYPE)
      if (!ctx) {
        throw new Error('2D context not supported')
      }
      this._ctx2D = ctx
      this._ctx2D.scale(this._dpr, this._dpr)
      this._ctx2D.imageSmoothingEnabled = false
    }
    return this._ctx2D
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    if (this._destroyed) {
      return
    }
    this._destroyed = true

    if (this._glId) {
      Telemetry.event('ctx:destroy', {}, undefined, this._glId)
    }

    if (this._handlersInited) {
      this._element.removeEventListener('webglcontextlost', this._handleContextLost)
      this._element.removeEventListener('webglcontextrestored', this._handleContextRestored)
      this._handlersInited = false
    }

    //
    try {
      if (this._ownership === 'internal') {
        this._element.width = 0
        this._element.height = 0
      }
    }
    catch {
      /* ignore */
    }

    if (this._ownership === 'internal') {
      const parent = this._element.parentNode
      if (parent) {
        parent.removeChild(this._element)
      }
    }
    else {
      this._ctx2D?.clearRect(0, 0, this.width, this.height)
    }

    this._onContextLostCallback = undefined
    this._onContextRestoredCallback = undefined
    this._isContextLost = false
    this._ctx2D = undefined
    this._cachedRect = undefined
  }

  /**
   * Обрабатывает событие context lost.
   */
  public onContextLost(callback: () => void): void {
    this._onContextLostCallback = callback
  }

  /**
   * Обрабатывает событие context restored.
   */
  public onContextRestored(callback: () => void): void {
    this._onContextRestoredCallback = callback
  }

  /**
   * Проверяет context lost.
   */
  public isContextLost(): boolean {
    return this._isContextLost
  }

  /**
   * Экспортирует текущий canvas frame без изменения layout/render state.
   */
  async exportImage(options: NovaExportImageOptions = {}): Promise<NovaExportImageResult> {
    if (this.isContextLost()) {
      throw new NovaExportError('context-lost', 'Nova canvas context is lost')
    }

    const format = options.format ?? 'png'
    const mime = EXPORT_MIME_BY_FORMAT[format]
    if (!mime) {
      throw new NovaExportError('unsupported-format', `Unsupported Nova export format: ${String(format)}`)
    }

    const source = this._element
    if (source.width <= 0 || source.height <= 0) {
      throw new NovaExportError('empty-canvas', 'Cannot export an empty Nova canvas')
    }

    const rect = options.rect ?? {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    }
    const pixelRatio = Math.max(0.01, options.pixelRatio ?? this.dpr)
    const targetWidth = Math.max(0, Math.floor(rect.width * pixelRatio))
    const targetHeight = Math.max(0, Math.floor(rect.height * pixelRatio))
    if (targetWidth <= 0 || targetHeight <= 0) {
      throw new NovaExportError('empty-canvas', 'Cannot export an empty Nova canvas rect')
    }

    const target = this._createExportCanvas(source, rect, targetWidth, targetHeight, pixelRatio, options.background)
    const quality = normalizeQuality(options.quality)

    try {
      if (options.preferBlob && typeof target.toBlob === 'function') {
        const blob = await canvasToBlob(target, mime, quality)
        if (blob) {
          return {
            format,
            width: targetWidth,
            height: targetHeight,
            pixelRatio,
            blob,
            byteLength: blob.size,
          }
        }
      }

      const dataUrl = target.toDataURL(mime, quality)
      return {
        format,
        width: targetWidth,
        height: targetHeight,
        pixelRatio,
        dataUrl,
        byteLength: estimateDataUrlByteLength(dataUrl),
      }
    }
    catch (error) {
      throw normalizeExportError(error)
    }
  }

  /**
   * Выполняет внутреннюю операцию create.
   */
  static create(
    width: number,
    height: number,
    contextType: RendererType,
    options: NovaCanvasCreateOptions = {},
  ): NovaCanvas {
    const canvas = document.createElement('canvas')
    const instance = new NovaCanvas(canvas, 'internal', options)
    instance.resize(width, height, options)

    instance._initContextLossHandlers()

    if (contextType === RendererType.Web2D) {
      instance.getContext2D()
    }
    else if (contextType === RendererType.WebGL) {
      // Целевой WebGL renderer сам создает WebGL2 context и не должен сначала привязывать WebGL1.
    }
    else {
      throw new Error(`Unsupported context type: ${contextType}`)
    }

    return instance
  }

  /**
   * Выполняет внутреннюю операцию attach.
   */
  static attach(canvas: HTMLCanvasElement, options: NovaCanvasCreateOptions = {}): NovaCanvas {
    const instance = new NovaCanvas(canvas, 'external', options)
    const rect = canvas.getBoundingClientRect()
    const width = options.width ?? rect.width
    const height = options.height ?? rect.height
    instance.resize(width, height, options)

    const contextType = options.contextType ?? RendererType.Web2D

    if (contextType === RendererType.Web2D) {
      instance.getContext2D()
    }

    return instance
  }

  /**
   * Вычисляет dpr.
   */
  private _resolveDpr(dpr?: number, maxDpr?: number): number {
    const raw = dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    return Math.max(1, Math.min(raw, maxDpr ?? this._maxDpr))
  }

  private _createExportCanvas(
    source: HTMLCanvasElement,
    rect: { x: number, y: number, width: number, height: number },
    targetWidth: number,
    targetHeight: number,
    pixelRatio: number,
    background?: string,
  ): HTMLCanvasElement {
    const sourceX = rect.x * this.dpr
    const sourceY = rect.y * this.dpr
    const sourceWidth = rect.width * this.dpr
    const sourceHeight = rect.height * this.dpr
    const fullFrame = !background
      && rect.x === 0
      && rect.y === 0
      && targetWidth === source.width
      && targetHeight === source.height
      && Math.abs(pixelRatio - this.dpr) < 0.001

    if (fullFrame) {
      return source
    }

    const target = document.createElement('canvas')
    target.width = targetWidth
    target.height = targetHeight
    const ctx = target.getContext(CANVAS_2D_CONTEXT_TYPE)
    if (!ctx) {
      throw new NovaExportError('context-lost', '2D export context is not available')
    }

    if (background) {
      ctx.save()
      ctx.fillStyle = background
      ctx.fillRect(0, 0, targetWidth, targetHeight)
      ctx.restore()
    }
    ctx.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight)
    return target
  }

  /**
   * Выполняет внутреннюю операцию init context loss handlers.
   */
  private _initContextLossHandlers(): void {
    if (this._handlersInited) {
      return
    }
    this._handlersInited = true

    this._element.addEventListener('webglcontextlost', this._handleContextLost, false)
    this._element.addEventListener('webglcontextrestored', this._handleContextRestored, false)
  }

  private _handleContextLost = (e: Event): void => {
    e.preventDefault()
    this._isContextLost = true

    if (this._glId) {
      Telemetry.event('ctx:lost', {}, undefined, this._glId)
      Telemetry.snapshot('lost')
    }

    this._onContextLostCallback?.()
  }

  private _handleContextRestored = (_e: Event): void => {
    this._isContextLost = false

    if (this._glId) {
      Telemetry.event('ctx:restored', {}, undefined, this._glId)
    }

    this._onContextRestoredCallback?.()
  }
}

function normalizeQuality(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(0, Math.min(1, value))
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number | undefined): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, mime, quality))
}

function estimateDataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) {
    return dataUrl.length
  }
  return Math.floor(dataUrl.slice(comma + 1).length * 0.75)
}

function normalizeExportError(error: unknown): NovaExportError {
  if (error instanceof NovaExportError) {
    return error
  }
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return new NovaExportError('tainted-canvas', 'Cannot export a tainted Nova canvas', error)
  }
  return new NovaExportError('tainted-canvas', 'Nova canvas export failed', error)
}

import type { NovaCanvasCreateOptions, NovaCanvasOwnership, NovaSizeOptions } from '@/domain/types/base.types'
import { RendererType } from '@/domain/types/renderer.types'
import { Telemetry } from '@/model/telemetry.ts'

const CANVAS_2D_CONTEXT_TYPE = '2d'

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
    this._dpr = this.resolveDpr(options.dpr, options.maxDpr)
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
    this._dpr = this.resolveDpr(options.dpr, this._maxDpr)
    const dpr = this._dpr

    this._element.width = Math.max(0, Math.floor(width * dpr))
    this._element.height = Math.max(0, Math.floor(height * dpr))
    this._element.style.width = `${width}px`
    this._element.style.height = `${height}px`

    if (this._glId) Telemetry.event('canvas:resize', { w: width, h: height, dpr }, undefined, this._glId)

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
      if (!ctx) throw new Error('2D context not supported')
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
    if (this._destroyed) return
    this._destroyed = true

    if (this._glId) Telemetry.event('ctx:destroy', {}, undefined, this._glId)

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
    } catch {
      /* ignore */
    }

    if (this._ownership === 'internal') {
      const parent = this._element.parentNode
      if (parent) parent.removeChild(this._element)
    } else {
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

    instance.initContextLossHandlers()

    if (contextType === RendererType.Web2D) {
      instance.getContext2D()
    } else if (contextType === RendererType.WebGL) {
      // Target WebGL renderer owns WebGL2 context creation and must not bind WebGL1 first.
    } else {
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

    if (contextType === RendererType.Web2D) instance.getContext2D()

    return instance
  }

  /**
   * Вычисляет dpr.
   */
  private resolveDpr(dpr?: number, maxDpr?: number): number {
    const raw = dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    return Math.max(1, Math.min(raw, maxDpr ?? this._maxDpr))
  }

  /**
   * Выполняет внутреннюю операцию init context loss handlers.
   */
  private initContextLossHandlers(): void {
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

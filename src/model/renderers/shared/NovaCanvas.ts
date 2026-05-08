import type { NovaCanvasCreateOptions, NovaCanvasOwnership, NovaSizeOptions } from '@/domain/types/base-types'
import { RendererType } from '@/domain/types/renderer-types'
import { Telemetry } from '@/model/telemetry.ts'

const CANVAS_2D_CONTEXT_TYPE = '2d'
const WEBGL_CONTEXT_TYPE = 'webgl'
const WEBGL_EXPERIMENTAL_CONTEXT_TYPE = 'experimental-webgl'

export class NovaCanvas {
  private readonly _element: HTMLCanvasElement
  private readonly _ownership: NovaCanvasOwnership

  private _ctx2D?: CanvasRenderingContext2D
  private _ctxWebGL?: WebGLRenderingContext
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

  private constructor(canvas: HTMLCanvasElement, ownership: NovaCanvasOwnership, options: NovaCanvasCreateOptions = {}) {
    this._element = canvas
    this._ownership = ownership
    this._dpr = this.resolveDpr(options.dpr, options.maxDpr)
    this._maxDpr = options.maxDpr ?? 2
    this._webglAttributes = options.webgl
  }

  get element(): HTMLCanvasElement {
    return this._element
  }

  get width(): number {
    return this._element.width / this._dpr
  }

  get height(): number {
    return this._element.height / this._dpr
  }

  get pixelWidth(): number {
    return this._element.width
  }

  get pixelHeight(): number {
    return this._element.height
  }

  get dpr(): number {
    return this._dpr
  }

  get maxDpr(): number {
    return this._maxDpr
  }

  getBoundingClientRect(): DOMRectReadOnly {
    if (!this._cachedRect) {
      this._cachedRect = this._element.getBoundingClientRect()
    }
    return this._cachedRect
  }

  invalidate(): void {
    this._cachedRect = undefined
  }

  resize(width: number, height: number, options: Partial<NovaSizeOptions> = {}): void {
    this._cachedRect = undefined

    this._maxDpr = options.maxDpr ?? this._maxDpr
    this._dpr = this.resolveDpr(options.dpr, this._maxDpr)
    const dpr = this._dpr

    // // Временно закомментировано, т.к. аффектит ОУ ресайзинг
    // // Если не изменился реальный размер canvas
    // const nextW = Math.max(0, Math.floor(width * dpr))
    // const nextH = Math.max(0, Math.floor(height * dpr))
    // if (this._element.width === nextW && this._element.height === nextH) {
    //   const cssW = `${width}px`
    //   const cssH = `${height}px`
    //   if (this._element.style.width !== cssW) this._element.style.width = cssW
    //   if (this._element.style.height !== cssH) this._element.style.height = cssH
    //   return
    // }
    //
    // //
    // //
    // this._element.width = nextW
    // this._element.height = nextH

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
    if (this._ctxWebGL) {
      this._ctxWebGL.viewport(0, 0, this._element.width, this._element.height)
    }
  }

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

  getContextWebGL(attributes?: WebGLContextAttributes): WebGLRenderingContext {
    if (!this._ctxWebGL) {
      const attrs: WebGLContextAttributes = attributes ?? this._webglAttributes ?? { alpha: true, antialias: true }
      const ctx =
        (this._element.getContext(WEBGL_CONTEXT_TYPE, attrs) as WebGLRenderingContext | null) ||
        (this._element.getContext(WEBGL_EXPERIMENTAL_CONTEXT_TYPE, attrs) as WebGLRenderingContext | null)
      if (!ctx) throw new Error('WebGL context not supported')
      this._ctxWebGL = ctx

      //
      //
      this._glId = this._glId ?? `gl_${Math.random().toString(36).slice(2)}`
      Telemetry.event(
        'ctx:create',
        {
          w: this.width,
          h: this.height,
          dpr: this._dpr,
          attrs,
        },
        undefined,
        this._glId,
      )
    }
    return this._ctxWebGL
  }

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
      if (this._ctxWebGL) {
        const loseCtx = this._ctxWebGL.getExtension('WEBGL_lose_context')
        loseCtx?.loseContext()
      }

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
    this._ctxWebGL = undefined
    this._cachedRect = undefined
  }

  public onContextLost(callback: () => void): void {
    this._onContextLostCallback = callback
  }

  public onContextRestored(callback: () => void): void {
    this._onContextRestoredCallback = callback
  }

  public isContextLost(): boolean {
    return this._isContextLost
  }

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
    } else if (contextType === RendererType.WebGLOld || contextType === RendererType.WebGL) {
      instance.getContextWebGL(options.webgl)
    } else {
      throw new Error(`Unsupported context type: ${contextType}`)
    }

    return instance
  }

  static attach(canvas: HTMLCanvasElement, options: NovaCanvasCreateOptions = {}): NovaCanvas {
    const instance = new NovaCanvas(canvas, 'external', options)
    const rect = canvas.getBoundingClientRect()
    const width = options.width ?? rect.width
    const height = options.height ?? rect.height
    instance.resize(width, height, options)

    instance.getContext2D()
    return instance
  }

  private resolveDpr(dpr?: number, maxDpr?: number): number {
    const raw = dpr ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
    return Math.max(1, Math.min(raw, maxDpr ?? this._maxDpr))
  }

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
    this._ctxWebGL = undefined

    if (this._glId) {
      Telemetry.event('ctx:lost', {}, undefined, this._glId)
      Telemetry.snapshot('lost')
    }

    this._onContextLostCallback?.()
  }

  private _handleContextRestored = (_e: Event): void => {
    this._isContextLost = false
    this._ctxWebGL = undefined // нужно будет получить заново через getContextWebGL()

    if (this._glId) {
      Telemetry.event('ctx:restored', {}, undefined, this._glId)
    }

    this._onContextRestoredCallback?.()
  }
}

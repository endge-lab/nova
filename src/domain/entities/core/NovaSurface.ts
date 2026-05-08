import type { NovaApp } from '@/domain/entities/app/NovaApp'
import { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import { NovaRenderer2D } from '@/domain/entities/graphics/NovaRenderer2D'
import { NovaRendererWebGL } from '@/domain/entities/graphics/NovaRendererWebGL'
import { NovaRenderQueueRenderer, type NovaRenderQueueSnapshot } from '@/domain/entities/graphics/NovaRenderQueueRenderer'
import {
  RendererType,
  type NovaRenderer,
  type NovaRenderCullingMode,
  type NovaRenderDirtyMode,
  type NovaRenderPipeline,
  type NovaRenderCullingStats,
  type NovaRenderQueueStats,
  type NovaRenderSubtreeStats,
} from '@/domain/types/renderer-types'
import type { NovaNodeProperties } from '@/domain/types/base-types'
import { NovaNode } from '@/domain/entities/core/NovaNode'
import type { ConstructorOrFactory } from '@endge/utils'
import { createInstance } from '@endge/utils'
import type { EventList } from '@endge/utils'

export class NovaSurface<E extends EventList> extends NovaNode<E> {
  readonly name: string

  private _canvas: NovaCanvas
  private _renderer: NovaRenderer
  private _queueRenderer: NovaRenderQueueRenderer
  private _activeRenderer: NovaRenderer

  protected _dirty: boolean = false
  private _renderPipeline: NovaRenderPipeline = 'immediate'
  private _renderDirtyMode: NovaRenderDirtyMode = 'full'
  private _renderCullingMode: NovaRenderCullingMode = 'off'
  private _renderQueueStats: NovaRenderQueueStats = {
    commands: 0,
    items: 0,
    batches: 0,
  }
  private _renderSubtreeStats: NovaRenderSubtreeStats = {
    rebuiltNodes: 0,
    cachedNodes: 0,
  }
  private _renderCullingStats: NovaRenderCullingStats = {
    testedNodes: 0,
    culledNodes: 0,
  }

  private readonly _rendererType: RendererType
  private readonly _novaApp: NovaApp<E>

  constructor(name: string, app: NovaApp<E>, type: RendererType) {
    super(app)
    this.name = name
    this._rendererType = type
    this._novaApp = app

    this._canvas = this._createCanvas(app.width, app.height)
    this._renderer =
      type === RendererType.Web2D
        ? new NovaRenderer2D(this._canvas, app.schema)
        : new NovaRendererWebGL(this._canvas, app.schema)
    this._queueRenderer = new NovaRenderQueueRenderer(this._renderer)
    this._activeRenderer = this._renderer

    this._subscribeToCanvasContextEvents()

    // Устанавливаем логические размеры (логическая система координат)
    this.options({
      width: app.width,
      height: app.height,
    })
  }

  override options(opts: Partial<NovaNodeProperties>): this {
    const { width, height } = opts

    if (width !== undefined && height !== undefined) {
      this._canvas.resize(width, height, {
        dpr: this._novaApp.dpr,
        maxDpr: this._novaApp.maxDpr,
      })
      this.width = width
      this.height = height
    }

    super.options(opts)
    return this
  }

  // Помимо базовой отрисовки в локальных координатах,
  // Очищаем второй буфер
  doRender(): void {
    this._renderer.clear()
    this._renderSubtreeStats = {
      rebuiltNodes: 0,
      cachedNodes: 0,
    }
    this._renderCullingStats = {
      testedNodes: 0,
      culledNodes: 0,
    }

    if (this._renderPipeline === 'queue') {
      this._queueRenderer.clearQueue()
      this._activeRenderer = this._queueRenderer
      try {
        super.doRender()
        this._renderQueueStats = this._queueRenderer.flush()
      } finally {
        this._activeRenderer = this._renderer
      }
      return
    }

    this._activeRenderer = this._renderer
    super.doRender()
  }

  canUseRenderSubtreeQueue(): boolean {
    return this._renderPipeline === 'queue' && this._renderDirtyMode === 'subtree'
  }

  beginRenderQueueSnapshot(): number {
    return this._queueRenderer.beginSnapshot()
  }

  endRenderQueueSnapshot(start: number): NovaRenderQueueSnapshot {
    return this._queueRenderer.endSnapshot(start)
  }

  replayRenderQueueSnapshot(snapshot: NovaRenderQueueSnapshot): void {
    this._queueRenderer.appendSnapshot(snapshot)
    this._renderSubtreeStats.cachedNodes += 1
  }

  markRenderNodeRebuilt(): void {
    this._renderSubtreeStats.rebuiltNodes += 1
  }

  markRenderNodeTestedForCulling(): void {
    this._renderCullingStats.testedNodes += 1
  }

  markRenderNodeCulled(): void {
    this._renderCullingStats.culledNodes += 1
  }

  doFlush(mainCtx: CanvasRenderingContext2D): void {
    this.flush(mainCtx)
  }

  flush(mainCtx: CanvasRenderingContext2D): void {
    mainCtx.save()
    mainCtx.setTransform(1, 0, 0, 1, 0, 0)
    mainCtx.scale(this.nova.dpr, this.nova.dpr)
    mainCtx.drawImage(
      this.canvas.element,
      0,
      0,
      this.canvas.pixelWidth,
      this.canvas.pixelHeight,
      this.x,
      this.y,
      this.width,
      this.height,
    )
    mainCtx.restore()
  }

  destroy(): void {
    this._queueRenderer?.destroy()
    this._renderer?.destroy()
    this._canvas?.destroy()
  }

  //
  // STATE
  //

  createNode<T extends NovaNode<E>>(
    NodeClassOrFactory?: ConstructorOrFactory<T, [NovaApp<E>, NovaSurface<E>, ...any[]]>,
    ...args: any[]
  ): T {
    const node: T = NodeClassOrFactory
      ? createInstance(NodeClassOrFactory, this._nova, this, ...args)
      : (new NovaNode<E>(this._nova, this) as T)

    this.addChild(node)

    return node
  }

  private _recreateCanvasAndRenderer(): void {
    console.warn(`[NovaSurface:${this.name}] Recreating canvas and renderer`)

    //
    this._renderer.destroy()
    this._canvas.destroy()

    // Создаём новый канвас и рендерер
    const newCanvas = this._createCanvas(this._novaApp.width, this._novaApp.height)
    const newRenderer =
      this._rendererType === RendererType.Web2D
        ? new NovaRenderer2D(newCanvas, this._novaApp.schema)
        : new NovaRendererWebGL(newCanvas, this._novaApp.schema)

    // Подписываемся на события снова
    newCanvas.onContextLost(() => {
      this._recreateCanvasAndRenderer()
    })

    // Обновляем ссылки
    this._canvas = newCanvas
    this._renderer = newRenderer
    this._queueRenderer.setTarget(newRenderer)
    this._activeRenderer = newRenderer

    // Восстанавливаем размеры
    this.options({
      width: this._novaApp.width,
      height: this._novaApp.height,
    })

    this._dirty = true
  }

  //
  // CONTEXT
  //

  private _subscribeToCanvasContextEvents(): void {
    this._canvas.onContextLost(() => {
      this._recreateCanvasAndRenderer()
    })
  }

  private _createCanvas(width: number, height: number): NovaCanvas {
    return NovaCanvas.create(width, height, this._rendererType, {
      dpr: this._novaApp.dpr,
      maxDpr: this._novaApp.maxDpr,
      webgl: this._novaApp.webglAttributes,
    })
  }

  //
  // ACCESS
  //

  get canvas(): NovaCanvas {
    return this._canvas
  }

  get renderer(): NovaRenderer {
    return this._activeRenderer
  }

  get renderPipeline(): NovaRenderPipeline {
    return this._renderPipeline
  }

  set renderPipeline(value: NovaRenderPipeline) {
    this._renderPipeline = value
  }

  get renderDirtyMode(): NovaRenderDirtyMode {
    return this._renderDirtyMode
  }

  set renderDirtyMode(value: NovaRenderDirtyMode) {
    this._renderDirtyMode = value
  }

  get renderCullingMode(): NovaRenderCullingMode {
    return this._renderCullingMode
  }

  set renderCullingMode(value: NovaRenderCullingMode) {
    this._renderCullingMode = value
  }

  get renderQueueStats(): NovaRenderQueueStats {
    return this._renderQueueStats
  }

  get renderSubtreeStats(): NovaRenderSubtreeStats {
    return this._renderSubtreeStats
  }

  get renderCullingStats(): NovaRenderCullingStats {
    return this._renderCullingStats
  }
}

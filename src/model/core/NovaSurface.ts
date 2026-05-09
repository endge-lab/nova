import type { NovaApp } from '@/model/app/NovaApp'
import { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import { NovaRenderQueueRenderer, type NovaRenderQueueSnapshot } from '@/model/renderers/shared/NovaRenderQueueRenderer'
import { assertNovaRendererTypeImplemented, createNovaRenderer } from '@/model/renderers/shared/NovaRendererFactory'
import { NovaRendererWebGL } from '@/model/renderers/webgl/NovaRendererWebGL'
import { NovaRenderCompiler } from '@/model/rendering/compiler/NovaRenderCompiler'
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
import { NovaNode } from '@/model/core/NovaNode'
import type { ConstructorOrFactory } from '@endge/utils'
import { createInstance } from '@endge/utils'
import type { EventList } from '@endge/utils'

export class NovaSurface<E extends EventList> extends NovaNode<E> {
  readonly name: string

  private _canvas: NovaCanvas
  private _ownsCanvas = true
  private _renderer: NovaRenderer
  private _queueRenderer: NovaRenderQueueRenderer
  private _activeRenderer: NovaRenderer
  private _renderCompiler?: NovaRenderCompiler<E>

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

    assertNovaRendererTypeImplemented(type)
    this._canvas = this._createCanvas(app.width, app.height)
    this._renderer = createNovaRenderer(type, this._canvas, app.schema, app.rendererConfig)
    this._queueRenderer = new NovaRenderQueueRenderer(this._renderer)
    this._activeRenderer = this._renderer
    if (type === RendererType.WebGL) {
      this._renderCompiler = new NovaRenderCompiler({
        schemaRegistry: app.schema,
        rendererConfig: app.rendererConfig,
      })
    }

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
    this._renderSubtreeStats = {
      rebuiltNodes: 0,
      cachedNodes: 0,
    }
    this._renderCullingStats = {
      testedNodes: 0,
      culledNodes: 0,
    }

    if (this._rendererType === RendererType.WebGL && this._renderer instanceof NovaRendererWebGL && this._renderCompiler) {
      const { frame } = this._renderCompiler.compileSurface(this)
      this._renderer.renderFrame(frame)
      this._renderQueueStats = {
        commands: frame.metrics.commands,
        items: frame.metrics.items,
        batches: frame.metrics.batches,
      }
      return
    }

    this._renderer.clear()

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
    return this._rendererType !== RendererType.WebGL && this._renderPipeline === 'queue' && this._renderDirtyMode === 'subtree'
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

  renderWithRenderer(renderer: NovaRenderer): void {
    const previous = this._activeRenderer
    this._activeRenderer = renderer
    try {
      super.doRender()
    } finally {
      this._activeRenderer = previous
    }
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
    if (this._ownsCanvas) this._canvas?.destroy()
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
    if (this._ownsCanvas) this._canvas.destroy()

    // Создаём новый канвас и рендерер
    const newCanvas = this._createCanvas(this._novaApp.width, this._novaApp.height)
    const newRenderer = createNovaRenderer(this._rendererType, newCanvas, this._novaApp.schema, this._novaApp.rendererConfig)

    // Подписываемся на события снова
    newCanvas.onContextLost(() => {
      this._recreateCanvasAndRenderer()
    })

    // Обновляем ссылки
    this._canvas = newCanvas
    this._renderer = newRenderer
    this._queueRenderer.setTarget(newRenderer)
    this._activeRenderer = newRenderer
    if (this._rendererType === RendererType.WebGL) {
      this._renderCompiler = new NovaRenderCompiler({
        schemaRegistry: this._novaApp.schema,
        rendererConfig: this._novaApp.rendererConfig,
      })
    }

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
    if (this._rendererType === RendererType.WebGL && this._novaApp.mainRendererType === RendererType.WebGL) {
      this._ownsCanvas = false
      return this._novaApp.canvas
    }

    this._ownsCanvas = true
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

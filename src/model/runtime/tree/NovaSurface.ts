import type { ConstructorOrFactory , EventList } from '@endge/utils'
import { createInstance } from '@endge/utils'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import { NovaCanvas } from '@/model/platform/NovaCanvas'
import { assertNovaRendererTypeImplemented, createNovaRenderer } from '@/model/render/backends/NovaRendererFactory'
import { NovaRenderer2D } from '@/model/render/backends/canvas2d/NovaRenderer2D'
import { NovaRendererWebGL } from '@/model/render/backends/webgl/NovaRendererWebGL'
import { createNovaRenderLayer } from '@/model/render/graph/NovaRenderLayer'
import { NovaRenderGraph } from '@/model/render/graph/NovaRenderGraph'
import { NovaRenderCompiler } from '@/model/render/compiler/NovaRenderCompiler'
import {
  RendererType,
  type NovaRenderer,
  type NovaRenderCullingMode,
  type NovaRenderDirtyMode,
  type NovaRenderPipeline,
  type NovaRenderCullingStats,
  type NovaRenderQueueStats,
  type NovaRenderSubtreeStats,
} from '@/domain/types/renderer.types'
import type { NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает logical surface, который связывает subtree, viewport и renderer pipeline.
 */
export class NovaSurface<E extends EventList> extends NovaNode<E> {
  readonly name: string

  private _canvas: NovaCanvas
  private _ownsCanvas = true
  private _renderer: NovaRenderer
  private _activeRenderer: NovaRenderer
  private _renderCompiler: NovaRenderCompiler<E>
  private _renderGraph: NovaRenderGraph
  private _renderMetrics: NovaRenderMetrics | null = null

  protected _dirty: boolean = false
  private _renderPipeline: NovaRenderPipeline = 'retained'
  private _renderDirtyMode: NovaRenderDirtyMode = 'graph'
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

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(name: string, app: NovaApp<E>, type: RendererType) {
    super(app)
    this.name = name
    this._rendererType = type
    this._novaApp = app

    assertNovaRendererTypeImplemented(type)
    this._canvas = this._createCanvas(app.width, app.height)
    this._renderer = createNovaRenderer(type, this._canvas, app.schema, app.rendererConfig)
    this._activeRenderer = this._renderer
    this._renderCompiler = new NovaRenderCompiler({
      schemaRegistry: app.schema,
      rendererConfig: app.rendererConfig,
      rendererType: type,
    })
    const rootLayer = createNovaRenderLayer('main')
    this._renderGraph = new NovaRenderGraph(name, rootLayer.rootGroup)

    this._subscribeToCanvasContextEvents()

    // Устанавливаем логические размеры (логическая система координат)
    this.options({
      width: app.width,
      height: app.height,
    })
  }

  /**
   * Выполняет внутреннюю операцию options.
   */
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
  /**
   * Выполняет внутреннюю операцию do render.
   */
  doRender(): void {
    this._renderSubtreeStats = {
      rebuiltNodes: 0,
      cachedNodes: 0,
    }
    this._renderCullingStats = {
      testedNodes: 0,
      culledNodes: 0,
    }

    const { frame } = this._renderCompiler.compileSurface(this)
    if (this._renderer instanceof NovaRendererWebGL) {
      const metrics = this._renderer.renderFrame(frame)
      this._renderMetrics = metrics
      this._renderQueueStats = {
        commands: metrics.commands,
        items: metrics.items,
        batches: metrics.batches,
      }
      return
    }

    if (this._renderer instanceof NovaRenderer2D) {
      const metrics = this._renderer.renderFrame(frame)
      this._renderMetrics = metrics
      this._renderQueueStats = {
        commands: metrics.commands,
        items: metrics.items,
        batches: metrics.batches,
      }
    }
  }

  /**
   * Выполняет render-операцию with renderer.
   */
  renderWithRenderer(renderer: NovaRenderer): void {
    const previous = this._activeRenderer
    this._activeRenderer = renderer
    try {
      super.doRender()
    } finally {
      this._activeRenderer = previous
    }
  }

  /**
   * Помечает render node rebuilt.
   */
  markRenderNodeRebuilt(): void {
    this._renderSubtreeStats.rebuiltNodes += 1
  }

  /**
   * Помечает render node tested for culling.
   */
  markRenderNodeTestedForCulling(): void {
    this._renderCullingStats.testedNodes += 1
  }

  /**
   * Помечает render node culled.
   */
  markRenderNodeCulled(): void {
    this._renderCullingStats.culledNodes += 1
  }

  /**
   * Выполняет внутреннюю операцию do flush.
   */
  doFlush(mainCtx: CanvasRenderingContext2D): void {
    this.flush(mainCtx)
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
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

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    this._renderer?.destroy()
    if (this._ownsCanvas) this._canvas?.destroy()
  }

  //
  // STATE
  //

  /**
   * Создает node.
   */
  createNode<T extends NovaNode<E>>(
    NodeClassOrFactory?: ConstructorOrFactory<T, [NovaApp<E>, NovaSurface<E>, ...Array<any>]>,
    ...args: Array<any>
  ): T {
    const node: T = NodeClassOrFactory
      ? createInstance(NodeClassOrFactory, this._nova, this, ...args)
      : (new NovaNode<E>(this._nova, this) as T)

    this.addChild(node)

    return node
  }

  /**
   * Выполняет внутреннюю операцию recreate canvas and renderer.
   */
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
    this._activeRenderer = newRenderer
    this._renderCompiler = new NovaRenderCompiler({
      schemaRegistry: this._novaApp.schema,
      rendererConfig: this._novaApp.rendererConfig,
      rendererType: this._rendererType,
    })
    const rootLayer = createNovaRenderLayer('main')
    this._renderGraph = new NovaRenderGraph(this.name, rootLayer.rootGroup)

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

  /**
   * Выполняет внутреннюю операцию subscribe to canvas context events.
   */
  private _subscribeToCanvasContextEvents(): void {
    this._canvas.onContextLost(() => {
      this._recreateCanvasAndRenderer()
    })
  }

  /**
   * Выполняет внутреннюю операцию create canvas.
   */
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

  /**
   * Возвращает canvas.
   */
  get canvas(): NovaCanvas {
    return this._canvas
  }

  /**
   * Возвращает renderer.
   */
  get renderer(): NovaRenderer {
    return this._activeRenderer
  }

  /**
   * Возвращает render graph.
   */
  get renderGraph(): NovaRenderGraph {
    return this._renderGraph
  }

  /**
   * Возвращает render pipeline.
   */
  get renderPipeline(): NovaRenderPipeline {
    return this._renderPipeline
  }

  /**
   * Обновляет render pipeline.
   */
  set renderPipeline(value: NovaRenderPipeline) {
    this._renderPipeline = value
  }

  /**
   * Возвращает render dirty mode.
   */
  get renderDirtyMode(): NovaRenderDirtyMode {
    return this._renderDirtyMode
  }

  /**
   * Обновляет render dirty mode.
   */
  set renderDirtyMode(value: NovaRenderDirtyMode) {
    this._renderDirtyMode = value
  }

  /**
   * Возвращает render culling mode.
   */
  get renderCullingMode(): NovaRenderCullingMode {
    return this._renderCullingMode
  }

  /**
   * Обновляет render culling mode.
   */
  set renderCullingMode(value: NovaRenderCullingMode) {
    this._renderCullingMode = value
  }

  /**
   * Возвращает render queue stats.
   */
  get renderQueueStats(): NovaRenderQueueStats {
    return this._renderQueueStats
  }

  /**
   * Возвращает render subtree stats.
   */
  get renderSubtreeStats(): NovaRenderSubtreeStats {
    return this._renderSubtreeStats
  }

  /**
   * Возвращает render culling stats.
   */
  get renderCullingStats(): NovaRenderCullingStats {
    return this._renderCullingStats
  }

  /**
   * Возвращает последние retained renderer metrics.
   */
  get renderMetrics(): NovaRenderMetrics | null {
    return this._renderMetrics
  }
}

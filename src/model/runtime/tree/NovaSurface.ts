import type { ConstructorOrFactory, EventList } from '@endge/utils'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import type {
  NovaRenderCompileStats,
  NovaRenderCullingMode,
  NovaRenderCullingStats,
  NovaRenderer,
} from '@/domain/types/renderer.types'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import { createInstance } from '@endge/utils'
import { NovaRenderCompiler } from '@/model/render/compiler/NovaRenderCompiler'
import { createNovaRenderLayer } from '@/model/render/graph/nova-render-layer'
import { NovaRenderGraph } from '@/model/render/graph/NovaRenderGraph'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Логическая render boundary внутри app-level render pass Nova.
 */
export class NovaSurface<E extends EventList> extends NovaNode<E> {
  readonly name: string

  private _activeRenderContext: NovaRenderer | null = null
  private readonly _renderCompiler: NovaRenderCompiler<E>
  private readonly _renderGraph: NovaRenderGraph
  private _renderMetrics: NovaRenderMetrics | null = null

  protected _dirty: boolean = false
  private _renderCullingMode: NovaRenderCullingMode = 'off'
  private _renderCompileStats: NovaRenderCompileStats = {
    rebuiltNodes: 0,
    cachedNodes: 0,
  }

  private _renderCullingStats: NovaRenderCullingStats = {
    testedNodes: 0,
    culledNodes: 0,
  }

  private readonly _novaApp: NovaApp<E>

  /**
   * Создает logical surface. Canvas и backend принадлежат NovaApp.
   */
  constructor(name: string, app: NovaApp<E>) {
    super(app)
    this.name = name
    this._novaApp = app
    this._renderCompiler = new NovaRenderCompiler({
      schemaRegistry: app.schema,
      rendererConfig: app.rendererConfig,
      rendererType: app.mainRendererType,
    })
    const rootLayer = createNovaRenderLayer('main')
    this._renderGraph = new NovaRenderGraph(name, rootLayer.rootGroup)

    this.options({
      width: app.width,
      height: app.height,
    })
  }

  /**
   * Обновляет logical dimensions. Physical canvas принадлежит приложению.
   */
  override options(opts: Partial<NovaNodeProperties>): this {
    const { width, height } = opts

    if (width !== undefined) {
      this.width = width
    }
    if (height !== undefined) {
      this.height = height
    }

    super.options(opts)
    return this
  }

  /**
   * Компилирует surface в retained frame.
   */
  compileRenderFrame(): NovaRenderFrame {
    this._renderCompileStats = {
      rebuiltNodes: 0,
      cachedNodes: 0,
    }
    this._renderCullingStats = {
      testedNodes: 0,
      culledNodes: 0,
    }

    return this._renderCompiler.compileSurface(this).frame
  }

  /**
   * Выполняет render hooks нод через recorder context.
   */
  renderWithContext(renderer: NovaRenderer): void {
    const previous = this._activeRenderContext
    this._activeRenderContext = renderer
    try {
      super.doRender()
    }
    finally {
      this._activeRenderContext = previous
    }
  }

  /**
   * Обновляет последние renderer metrics после backend replay.
   */
  setRenderMetrics(metrics: NovaRenderMetrics): void {
    this._renderMetrics = metrics
  }

  /**
   * Помечает node как rebuilt во время compile.
   */
  markRenderNodeRebuilt(): void {
    this._renderCompileStats.rebuiltNodes += 1
  }

  /**
   * Помечает node как проверенную для culling.
   */
  markRenderNodeTestedForCulling(): void {
    this._renderCullingStats.testedNodes += 1
  }

  /**
   * Помечает node как culled.
   */
  markRenderNodeCulled(): void {
    this._renderCullingStats.culledNodes += 1
  }

  /**
   * Освобождает resources логического surface.
   */
  destroy(): void {
    this._activeRenderContext = null
  }

  /**
   * Создает node внутри этого surface.
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
   * Возвращает app-owned canvas.
   */
  get canvas(): NovaCanvas {
    return this._novaApp.canvas
  }

  /**
   * Возвращает текущий render context. Доступен только во время compile.
   */
  get renderer(): NovaRenderer {
    if (!this._activeRenderContext) {
      throw new Error(`NovaSurface:${this.name} renderer is available only during render().`)
    }
    return this._activeRenderContext
  }

  /**
   * Возвращает render graph.
   */
  get renderGraph(): NovaRenderGraph {
    return this._renderGraph
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
   * Возвращает compile stats последнего retained frame compile.
   */
  get renderCompileStats(): NovaRenderCompileStats {
    return this._renderCompileStats
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

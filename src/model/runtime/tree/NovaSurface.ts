import type { ConstructorOrFactory, EventList } from '@endge/utils'
import { createInstance } from '@endge/utils'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import { createNovaRenderLayer } from '@/model/render/graph/NovaRenderLayer'
import { NovaRenderGraph } from '@/model/render/graph/NovaRenderGraph'
import { NovaRenderCompiler } from '@/model/render/compiler/NovaRenderCompiler'
import type {
  NovaRenderCompileStats,
  NovaRenderCullingMode,
  NovaRenderCullingStats,
  NovaRenderer,
} from '@/domain/types/renderer.types'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Logical render boundary inside a Nova app-level render pass.
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
   * Creates a logical surface. Canvas and backend are owned by NovaApp.
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
   * Updates logical dimensions. The physical canvas is app-owned.
   */
  override options(opts: Partial<NovaNodeProperties>): this {
    const { width, height } = opts

    if (width !== undefined) this.width = width
    if (height !== undefined) this.height = height

    super.options(opts)
    return this
  }

  /**
   * Compiles this surface into a retained frame.
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
   * Runs node render hooks against a recorder context.
   */
  renderWithContext(renderer: NovaRenderer): void {
    const previous = this._activeRenderContext
    this._activeRenderContext = renderer
    try {
      super.doRender()
    } finally {
      this._activeRenderContext = previous
    }
  }

  /**
   * Updates latest renderer metrics after backend replay.
   */
  setRenderMetrics(metrics: NovaRenderMetrics): void {
    this._renderMetrics = metrics
  }

  /**
   * Marks a node as rebuilt during compile.
   */
  markRenderNodeRebuilt(): void {
    this._renderCompileStats.rebuiltNodes += 1
  }

  /**
   * Marks a node as tested for culling.
   */
  markRenderNodeTestedForCulling(): void {
    this._renderCullingStats.testedNodes += 1
  }

  /**
   * Marks a node as culled.
   */
  markRenderNodeCulled(): void {
    this._renderCullingStats.culledNodes += 1
  }

  /**
   * Releases logical surface resources.
   */
  destroy(): void {
    this._activeRenderContext = null
  }

  /**
   * Creates node under this surface.
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
   * Returns app-owned canvas.
   */
  get canvas(): NovaCanvas {
    return this._novaApp.canvas
  }

  /**
   * Returns current render context. Available only during compile.
   */
  get renderer(): NovaRenderer {
    if (!this._activeRenderContext) {
      throw new Error(`NovaSurface:${this.name} renderer is available only during render().`)
    }
    return this._activeRenderContext
  }

  /**
   * Returns render graph.
   */
  get renderGraph(): NovaRenderGraph {
    return this._renderGraph
  }

  /**
   * Returns render culling mode.
   */
  get renderCullingMode(): NovaRenderCullingMode {
    return this._renderCullingMode
  }

  /**
   * Updates render culling mode.
   */
  set renderCullingMode(value: NovaRenderCullingMode) {
    this._renderCullingMode = value
  }

  /**
   * Returns compile stats for the last retained frame compile.
   */
  get renderCompileStats(): NovaRenderCompileStats {
    return this._renderCompileStats
  }

  /**
   * Returns render culling stats.
   */
  get renderCullingStats(): NovaRenderCullingStats {
    return this._renderCullingStats
  }

  /**
   * Returns latest retained renderer metrics.
   */
  get renderMetrics(): NovaRenderMetrics | null {
    return this._renderMetrics
  }
}

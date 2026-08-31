import type { RaphApp, RaphLocalPhaseContext, RaphNode } from '@endge/raph'
import type { EventList } from '@endge/utils'
import type {
  NovaAppCreateOptions,
  NovaAppOptions,
  NovaDebugOptions,
  NovaInputOptions,
  NovaNodeProperties,
  NovaSizeOptions,
  ResolvedNovaInputOptions,
} from '@/domain/types/base.types'
import type { NovaNodeEventHandlers } from '@/domain/types/events.types'
import type { NovaExportImageOptions, NovaExportImageResult } from '@/domain/types/export.types'
import type { NovaHitTestMode } from '@/domain/types/renderer.types'
import type { NovaRendererConfig, NovaRendererConfigInput } from '@/domain/types/rendering/index'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import type { NovaScene } from '@/model/runtime/scene/NovaScene'
import { Raph, RaphLocalPhase, RaphSchedulerType } from '@endge/raph'
import { EventBus } from '@endge/utils'
import { NovaPhase } from '@/domain/constants/nova-phase'
import { RendererType } from '@/domain/types/renderer.types'
import { NovaMotionEngine } from '@/model/motion/NovaMotionEngine'
import { NovaCanvas } from '@/model/platform/NovaCanvas'
import { createNovaRenderBackend } from '@/model/render/backends/nova-render-backend-factory'
import { NovaRenderOrchestrator } from '@/model/render/orchestration/NovaRenderOrchestrator'
import { resolveNovaRendererConfig } from '@/model/render/policy/nova-render-policy'
import { createNovaRaphRuntime } from '@/model/runtime/app/createNovaRaphRuntime'
import { NovaAssetRegistry, NovaAssets } from '@/model/runtime/assets/NovaAssetRegistry'
import { NovaCommandBus } from '@/model/runtime/commands/NovaCommandBus'
import { NovaComponentRegistry } from '@/model/runtime/components/NovaComponentRegistry'
import { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import { NovaCursorManager } from '@/model/runtime/cursor/NovaCursorManager'
import { NovaDebug } from '@/model/runtime/debug/NovaDebug'
import { NovaMetrics } from '@/model/runtime/debug/NovaMetrics'
import { NovaDiagnostics_Module } from '@/model/runtime/diagnostics/NovaDiagnostics_Module'
import { NovaEvents } from '@/model/runtime/interaction/NovaEvents'
import { NovaStore } from '@/model/runtime/state/NovaStore'
import { NovaSyncScope } from '@/model/runtime/sync/NovaSyncScope'
import { NovaNode } from '@/model/runtime/tree/NovaNode'
import { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import { NovaSemanticService } from '@/model/semantic/NovaSemanticService'
import { NovaSoundEngine } from '@/model/sound/NovaSoundEngine'
import { Telemetry } from '@/model/telemetry'
import { NovaThemeService } from '@/model/theme/NovaThemeService'

/**
 * Описывает backend diagnostics switch.
 */
interface NovaRendererDiagnosticsSwitch {
  diagnostics?: {
    enabled: boolean
  }
}

/**
 * Управляет жизненным циклом Nova runtime, canvas, input, surfaces и фазами Raph.
 */
export class NovaApp<E extends EventList = Record<string, any>> {
  //
  // Ядро приложения: граф, canvas, renderer и события.
  private readonly _raph: RaphApp<NovaNodeProperties>
  private readonly _ownsRaphKernel: boolean
  private readonly _canvas: NovaCanvas
  private readonly _backend: NovaRenderBackend
  private readonly _orchestrator: NovaRenderOrchestrator<E>
  private readonly _mainRendererType: RendererType
  private readonly _events: NovaEvents<E>

  //
  // Настройки ввода, WebGL context attributes и глобальный renderer config.
  private readonly _inputOptions: ResolvedNovaInputOptions
  private readonly _webglAttributes?: WebGLContextAttributes
  private _rendererConfig: NovaRendererConfig

  //
  // Порядок surfaces нужен для стабильного compositing и hit-test.
  private readonly _surfaceOrder = new WeakMap<NovaSurface<E>, number>()
  private readonly _orderedSurfaces: Array<NovaSurface<E>> = []
  private readonly _dirtySurfaces = new Set<NovaSurface<E>>()
  private _surfaceOrderCounter = 0
  private _textRasterContinuationPending = false

  //
  // Общие runtime-сервисы приложения.
  readonly store = new NovaStore()
  readonly schema: NovaSchemaRegistry
  readonly components = new NovaComponentRegistry()
  readonly motion = new NovaMotionEngine(this)
  readonly sound: NovaSoundEngine
  readonly theme: NovaThemeService<E>
  readonly cursors: NovaCursorManager<E>
  readonly bus: EventBus<E>
  readonly commands = new NovaCommandBus()
  readonly metrics: NovaMetrics
  readonly assets = new NovaAssetRegistry(NovaAssets.global, () => this._invalidateAssets())
  readonly sync: NovaSyncScope
  readonly semantics = new NovaSemanticService()

  //
  // Текущее состояние debug-конфигурации.
  private _debugOptions: NovaDebugOptions = { enabled: false }

  //
  // Внутренний debugger и состояние keyboard routing.
  private readonly _debugger = new NovaDebug()
  private readonly _diagnostics: NovaDiagnostics_Module<E>
  private _keyboardActive = false
  private _keyboardHovered = false
  private _contextVersion = 0
  private readonly _ownsSyncScope: boolean
  private _globalThemeDispose: (() => void) | null = null

  /**
   * Создает приложение, подключает canvas, input, renderer и Raph-loop.
   */
  constructor(options: NovaAppCreateOptions<E>) {
    if (!(options.target instanceof HTMLCanvasElement)) {
      throw new TypeError('NovaApp target must be an HTMLCanvasElement')
    }

    //
    // Сначала нормализуем базовую конфигурацию, потому что от нее зависит canvas и renderer.
    this._inputOptions = this._resolveInputOptions(options.input)
    this._webglAttributes = options.renderer?.webgl
    this._mainRendererType = options.renderer?.main ?? RendererType.WebGL
    this._rendererConfig = resolveNovaRendererConfig(options.renderer?.config)
    this._canvas = NovaCanvas.attach(options.target, {
      ...options.size,
      webgl: this._webglAttributes,
      contextType: this._mainRendererType,
    })

    //
    // Создаем registry, backend и event system, которые дальше используют surfaces и nodes.
    this.schema = options.schemaRegistry ?? new NovaSchemaRegistry()
    this._ownsSyncScope = !options.syncScope
    this.sync = options.syncScope ?? new NovaSyncScope()
    this._backend = createNovaRenderBackend(this._mainRendererType, this._canvas, this.schema, this._rendererConfig, this.assets)
    this._orchestrator = new NovaRenderOrchestrator(this._backend)
    this._events = new NovaEvents(this)
    this.sound = new NovaSoundEngine(this, options.sound)
    this.cursors = new NovaCursorManager(this)
    this.metrics = new NovaMetrics(() => this.raph.UPS)

    //
    // Поднимаем app-level bus, debug и telemetry до запуска Raph-фаз.
    this.bus = new EventBus<E>(options.predefinedEvents ?? [])
    this._debugOptions.enabled = options.debug?.enabled ?? false
    this._debugger.enabled = this._debugOptions.enabled === true
    if (this._debugOptions.enabled) {
      this._debugger.startDisplayMonitor()
    }
    if (options.debug?.telemetry !== undefined) {
      Telemetry.enabled = options.debug.telemetry
    }

    //
    // Подключаем DOM-события после создания bus и input options.
    this._setupEventListeners()

    //
    // Инициализируем Raph core и root node.
    this._ownsRaphKernel = !options.raph?.kernel
    this._raph = createNovaRaphRuntime(this, {
      kernel: options.raph?.kernel,
      runtimeId: options.raph?.runtimeId,
      scheduler: options.scheduler?.type ?? RaphSchedulerType.AnimationFrame,
    })
    this._diagnostics = new NovaDiagnostics_Module(this, {
      setRendererDiagnosticsEnabled: enabled => this._setRendererDiagnosticsEnabled(enabled),
    })
    this.theme = new NovaThemeService(this, options.theme)
    this._diagnostics.configure(options.diagnostics)
    this.resize(options.size)

    if (options.scheduler?.loop) {
      this.startLoop()
    }
    else {
      this.raph.invalidate()
    }
  }

  /**
   * Запускает начало кадра, motion engine и frame-level diagnostics.
   */
  @RaphLocalPhase({ name: NovaPhase.Before, priority: -1, always: true })
  before(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this.metrics.markFrameStart()
    this._diagnostics.frameStart()
    this._diagnostics.phaseStart('before')
    this._debugger.frameStart()
    this.motion.tick(p.frame)
    this._diagnostics.phaseEnd()
  }

  /**
   * Выполняет preupdate-фазу для dirty nodes.
   */
  @RaphLocalPhase({ name: NovaPhase.PreUpdate, priority: 0 })
  preupdate(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this._diagnostics.recordDirtyNodes(p.dirty.length)
    this._debugger.phaseStart('preupdate')
    this._diagnostics.phaseStart('preupdate')
    Raph.processDirtyNodes({ payload: p })
    this._diagnostics.phaseEnd()
    this._debugger.phaseEnd()
  }

  /**
   * Выполняет update-фазу для dirty nodes.
   */
  @RaphLocalPhase({ name: NovaPhase.Update, priority: 1 })
  update(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this._diagnostics.recordDirtyNodes(p.dirty.length)
    this._debugger.phaseStart('update')
    this._diagnostics.phaseStart('update')
    Raph.processDirtyNodes({ payload: p })
    this._diagnostics.phaseEnd()
    this._debugger.phaseEnd()
  }

  /**
   * Выполняет matrix-фазу и обновляет transform state dirty nodes.
   */
  @RaphLocalPhase({ name: NovaPhase.Matrix, priority: 2 })
  matrix(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this._diagnostics.recordDirtyNodes(p.dirty.length)
    this._debugger.phaseStart('matrix')
    this._diagnostics.phaseStart('matrix')
    Raph.processDirtyNodes({ payload: p })
    this._diagnostics.phaseEnd()
    this._debugger.phaseEnd()
  }

  /**
   * Собирает dirty surfaces и запускает render от корня каждого surface.
   */
  @RaphLocalPhase({ name: NovaPhase.Render, priority: 3, mode: 'dirty' })
  render(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this._debugger.phaseStart('render')
    this._diagnostics.phaseStart('render')
    this._diagnostics.recordDirtyRenderNodes(p.dirty.length)

    const dirtySurfaces = new Set<NovaSurface<E>>()

    for (const node of p.dirty) {
      for (const prop of p.phase.properties) {
        prop.computeOn(node)
      }

      if (node instanceof NovaSurface) {
        dirtySurfaces.add(node)
      }
      else if (node instanceof NovaNode) {
        if (p.events?.has(node)) {
          node.markRenderFrameDirty(true)
        }
        dirtySurfaces.add(node.surface)
      }
    }

    for (const surface of dirtySurfaces) {
      this._dirtySurfaces.add(surface)
    }

    this._diagnostics.phaseEnd()
    this._debugger.phaseEnd()
  }

  /**
   * Компилирует dirty surfaces и replay-ит все retained frames в основной canvas.
   */
  @RaphLocalPhase({ name: NovaPhase.Flush, priority: 4 })
  flush(): void {
    this._debugger.phaseStart('flush')
    this._diagnostics.phaseStart('flush')

    const surfaces = this._getOrderedSurfaces()
    this._orchestrator.render(surfaces, this._dirtySurfaces)
    this.cursors.reapplyNativeCursor()
    const shouldContinueTextRaster = surfaces.some(surface => this._shouldContinueTextRaster(surface))
    this._dirtySurfaces.clear()

    //
    // Mark rendered frame нужен метрикам даже тогда, когда Web2D flush не выполнялся.
    this._debugger.markRenderedFrame()
    this.metrics.markDraw()

    //
    // Закрываем debug-фазу после всех операций кадра.
    this._diagnostics.phaseEnd()
    this._debugger.phaseEnd()

    if (shouldContinueTextRaster) {
      this._scheduleTextRasterContinuation(surfaces)
    }
  }

  /**
   * Проверяет, нужно ли дорендерить deferred text atlas без пользовательского input.
   */
  private _shouldContinueTextRaster(surface: NovaSurface<E>): boolean {
    const metrics = surface.renderMetrics
    if (!metrics) {
      return false
    }

    return (metrics.textRasterDeferred ?? 0) > 0
  }

  /**
   * Планирует continuation repaint вне текущего flush stack.
   */
  private _scheduleTextRasterContinuation(surfaces: Array<NovaSurface<E>>): void {
    if (this._textRasterContinuationPending) {
      return
    }
    this._textRasterContinuationPending = true
    const deferredSurfaces = [...surfaces]
    queueMicrotask(() => {
      this._textRasterContinuationPending = false
      for (const surface of deferredSurfaces) {
        this.raph.dirty('flush', surface)
      }
    })
  }

  /**
   * Завершает кадр и обновляет frame-level metrics.
   */
  @RaphLocalPhase({ name: NovaPhase.After, priority: 10, always: true })
  after(): void {
    this._diagnostics.phaseStart('after')
    this.cursors.reapplyNativeCursor()
    this._debugger.frameEnd()
    this.metrics.markFrameEnd()
    this._diagnostics.phaseEnd()
    this._diagnostics.frameEnd()
  }

  /**
   * Планирует выполнение Raph-фаз при наличии dirty nodes.
   */
  invalidate(): void {
    this.raph.invalidate()
  }

  /**
   * Помечает render surfaces dirty после async asset updates.
   */
  private _invalidateAssets(): void {
    for (const surface of this.surfaces) {
      surface.dirty({ render: true })
    }
    this.raph.invalidate()
  }

  /**
   * Увеличивает версию scoped context для lazy invalidation inject-cache.
   */
  bumpContextVersion(): number {
    this._contextVersion += 1
    return this._contextVersion
  }

  /**
   * Запускает постоянный scheduler loop.
   */
  startLoop(): void {
    this.raph.startLoop()
  }

  /**
   * Останавливает постоянный scheduler loop.
   */
  stopLoop(): void {
    this.raph.stopLoop()
  }

  /**
   * Применяет runtime-настройки приложения без пересоздания NovaApp.
   */
  options(opts: Partial<NovaAppOptions>): void {
    if (opts.debug !== undefined) {
      this._debugOptions.enabled = opts.debug
      this._debugger.enabled = opts.debug === true
      if (opts.debug) {
        this._debugger.startDisplayMonitor()
      }
      else {
        this._debugger.stopDisplayMonitor()
      }
    }

    if (opts.diagnostics !== undefined) {
      this._diagnostics.configure(opts.diagnostics)
    }

    if (opts.loop !== undefined && opts.loop !== this.raph.loopEnabled) {
      if (opts.loop) {
        this.startLoop()
      }
      else {
        this.stopLoop()
      }
    }

    if (opts.width !== undefined || opts.height !== undefined || opts.dpr !== undefined || opts.maxDpr !== undefined) {
      this.resize({
        width: opts.width,
        height: opts.height,
        dpr: opts.dpr,
        maxDpr: opts.maxDpr,
      })
    }
  }

  /**
   * Передает DOM-событие в Nova event system.
   */
  handleEvent(type: keyof NovaNodeEventHandlers, event: Event): boolean {
    if (type === 'mousedown' || type === 'mouseup' || type === 'click' || type === 'keydown') {
      this.sound.unlockFromInput()
    }
    return this._events.handle(type, event)
  }

  /**
   * Переключает стратегию hit-test для интерактивных nodes.
   */
  setHitTestMode(mode: NovaHitTestMode): void {
    this._events.hitTestMode = mode
  }

  /**
   * Обновляет глобальный renderer config с учетом текущих defaults.
   */
  configureRenderer(config: NovaRendererConfigInput): NovaRendererConfig {
    this._rendererConfig = resolveNovaRendererConfig(config, this._rendererConfig)
    return this._rendererConfig
  }

  /**
   * Экспортирует текущий canvas frame и опционально добавляет semantic snapshot.
   */
  async exportImage(options: NovaExportImageOptions = {}): Promise<NovaExportImageResult> {
    const result = await this.canvas.exportImage(options)
    if (!options.includeSemanticSnapshot) {
      return result
    }
    return {
      ...result,
      semanticSnapshot: this.semantics.snapshot(),
    }
  }

  /**
   * Создает, монтирует и возвращает сцену, привязанную к этому приложению.
   */
  createScene<T extends NovaScene<E>>(SceneClass: new (app: NovaApp<E>, ...args: Array<any>) => T, ...args: Array<any>): T {
    const scene = new SceneClass(this, ...args)
    scene.mount()
    return scene
  }

  /**
   * Возвращает Raph runtime приложения.
   */
  get raph(): RaphApp<NovaNodeProperties> {
    return this._raph
  }

  /**
   * Возвращает версию scoped context приложения.
   */
  get contextVersion(): number {
    return this._contextVersion
  }

  /**
   * Возвращает canvas wrapper приложения.
   */
  get canvas(): NovaCanvas {
    return this._canvas
  }

  /**
   * Обновляет CSS cursor основного canvas независимо от active renderer backend.
   */
  cursor(value: string): void {
    this.cursors.setNativeCursor(value)
  }

  /**
   * Возвращает Nova event system.
   */
  get events(): NovaEvents<E> {
    return this._events
  }

  /**
   * Возвращает surfaces, подключенные к root Raph graph.
   */
  get surfaces(): Array<NovaSurface<E>> {
    return this.raph.root.children as unknown as Array<NovaSurface<E>>
  }

  /**
   * Возвращает количество dirty surfaces текущего frame.
   */
  get dirtySurfaceCount(): number {
    return this._dirtySurfaces.size
  }

  /**
   * Возвращает runtime debugger приложения.
   */
  get debugger(): NovaDebug {
    return this._debugger
  }

  /**
   * Возвращает runtime diagnostics приложения.
   */
  get diagnostics(): NovaDiagnostics_Module<E> {
    return this._diagnostics
  }

  /**
   * Возвращает текущую ширину root canvas в logical pixels.
   */
  get width(): number {
    return this.raph.root.get('width')
  }

  /**
   * Возвращает текущую высоту root canvas в logical pixels.
   */
  get height(): number {
    return this.raph.root.get('height')
  }

  /**
   * Возвращает фактический device pixel ratio canvas.
   */
  get dpr(): number {
    return this.canvas.dpr
  }

  /**
   * Возвращает верхнее ограничение device pixel ratio.
   */
  get maxDpr(): number {
    return this.canvas.maxDpr
  }

  /**
   * Возвращает WebGL context attributes, переданные при создании приложения.
   */
  get webglAttributes(): WebGLContextAttributes | undefined {
    return this._webglAttributes
  }

  /**
   * Возвращает основной renderer type приложения.
   */
  get mainRendererType(): RendererType {
    return this._mainRendererType
  }

  /**
   * Возвращает актуальный глобальный renderer config.
   */
  get rendererConfig(): NovaRendererConfig {
    return this._rendererConfig
  }

  /**
   * Возвращает resolved input options.
   */
  get inputOptions(): ResolvedNovaInputOptions {
    return this._inputOptions
  }

  /**
   * Создает logical surface для app-level backend.
   */
  createSurface<T extends NovaSurface<E>>(
    name: string,
    SurfaceClass: new (...args: Array<any>) => T = NovaSurface<E> as any,
    ...args: Array<any>
  ): T {
    const surface = new SurfaceClass(name, this, ...args)
    return this.addSurface(surface)
  }

  /**
   * Добавляет surface в Raph graph, монтирует subtree и обновляет порядок слоев.
   */
  addSurface<T extends NovaSurface<E>>(surface: T): T {
    this._ensureSurfaceOrder(surface)

    //
    // Новый surface сразу получает размеры приложения, чтобы первая отрисовка была синхронной с root canvas.
    surface.options({
      width: this.width,
      height: this.height,
    })

    //
    // После добавления в Raph graph surface может участвовать в фазах update, matrix и render.
    this.raph.addNode(surface as unknown as RaphNode<NovaNodeProperties>)
    surface.mountSubtree()
    this.invalidate()

    //
    // Возвращаем исходный instance, чтобы вызывающий код мог сразу настраивать конкретный subtype.
    return surface
  }

  /**
   * Удаляет logical surface из app-level render graph и retained frame cache.
   */
  removeSurface(surface: NovaSurface<E>): void {
    this._dirtySurfaces.delete(surface)
    this._surfaceOrder.delete(surface)
    this._orchestrator.deleteSurface(surface)
    surface.remove()
    this.invalidate()
  }

  /**
   * Возвращает surfaces в порядке compositing.
   */
  private _getOrderedSurfaces(): Array<NovaSurface<E>> {
    this._orderedSurfaces.length = 0

    for (const surface of this.surfaces) {
      this._ensureSurfaceOrder(surface)
      this._orderedSurfaces.push(surface)
    }

    //
    // Больший zIndex surface композитится позже и оказывается выше.
    // При равном zIndex сохраняем порядок добавления слоев.
    this._orderedSurfaces.sort((a, b) => {
      const weightDiff = a.weight - b.weight
      if (weightDiff !== 0) {
        return weightDiff
      }
      return this._surfaceOrderOf(a) - this._surfaceOrderOf(b)
    })

    return this._orderedSurfaces
  }

  /**
   * Фиксирует стабильный порядок добавления surface, если он еще не был сохранен.
   */
  private _ensureSurfaceOrder(surface: NovaSurface<E>): void {
    if (this._surfaceOrder.has(surface)) {
      return
    }
    this._surfaceOrder.set(surface, this._surfaceOrderCounter++)
  }

  /**
   * Возвращает стабильный индекс добавления surface.
   */
  private _surfaceOrderOf(surface: NovaSurface<E>): number {
    this._ensureSurfaceOrder(surface)
    return this._surfaceOrder.get(surface)!
  }

  /**
   * Регистрирует node в интерактивном индексе событий.
   */
  registerInteractiveNode(node: NovaNode<E>): void {
    this._events.registerInteractiveNode(node)
  }

  /**
   * Удаляет node из всех event indexes и active references.
   */
  unregisterInteractiveNode(node: NovaNode<E>): void {
    this._events.removeNodeReferences(node)
  }

  /**
   * Сравнивает две nodes по итоговому visual order с учетом surface и hierarchy.
   */
  compareRenderOrder(a: NovaNode<E>, b: NovaNode<E>): number {
    //
    // Одинаковая node всегда имеет одинаковый render order.
    if (a === b) {
      return 0
    }
    if (a.surface !== b.surface) {
      const weightDiff = a.surface.weight - b.surface.weight
      if (weightDiff !== 0) {
        return weightDiff
      }
      return this._surfaceOrderOf(a.surface) - this._surfaceOrderOf(b.surface)
    }

    //
    // Для nodes внутри одного surface сравниваем полный путь от surface root до самой node.
    const aStamp = this.getRenderOrderStamp(a)
    const bStamp = this.getRenderOrderStamp(b)
    const min = Math.min(aStamp.length, bStamp.length)

    //
    // Первый отличающийся сегмент пути определяет, какая node должна быть выше.
    for (let index = 0; index < min; index++) {
      const diff = aStamp[index] - bStamp[index]
      if (diff !== 0) {
        return diff
      }
    }

    //
    // Если общий путь одинаковый, более глубокая node находится внутри уже отсортированного родителя.
    return aStamp.length - bStamp.length
  }

  /**
   * Строит числовой stamp, который описывает положение node в render order.
   */
  getRenderOrderStamp(node: NovaNode<E>): Array<number> {
    //
    // Stamp начинается с surface, потому что surfaces композитятся независимо от внутренней иерархии.
    const path = this._getRenderPath(node)
    const stamp: Array<number> = [node.surface.weight, this._surfaceOrderOf(node.surface)]

    //
    // Каждый уровень добавляет zIndex текущей node и ее позицию среди детей родителя.
    for (let index = 1; index < path.length; index++) {
      const current = path[index]
      const parent = path[index - 1]
      stamp.push(current.weight, parent.renderOrderIndexOf(current))
    }

    //
    // Полученный массив можно сравнивать лексикографически без повторного обхода дерева.
    return stamp
  }

  /**
   * Возвращает путь от surface root до указанной node.
   */
  private _getRenderPath(node: NovaNode<E>): Array<NovaNode<E>> {
    const path: Array<NovaNode<E>> = []
    let current: unknown = node

    while (current instanceof NovaNode) {
      path.unshift(current)
      current = current.parent
    }

    return path
  }

  /**
   * Меняет размеры root canvas и синхронизирует dimensions всех surfaces.
   */
  resize(size: Partial<NovaSizeOptions> = {}): void {
    //
    // Сначала обновляем root dimensions, чтобы все зависимые фазы видели новые размеры.
    const root = this.raph.root!

    const newWidth = size.width ?? root.get('width') ?? this.canvas.width
    const newHeight = size.height ?? root.get('height') ?? this.canvas.height

    root.set('width', newWidth)
    root.set('height', newHeight)

    this._canvas.resize(newWidth, newHeight, {
      dpr: size.dpr,
      maxDpr: size.maxDpr,
    })

    //
    // Все surfaces получают новый viewport и становятся dirty для пересчета layout, matrix и render.
    for (const surface of this.surfaces) {
      surface.options({ width: newWidth, height: newHeight })
      surface.dirty({ update: true, matrix: true, render: true })
    }

    this.raph.invalidate()
  }

  /**
   * Освобождает runtime, события, metrics, surfaces и canvas.
   */
  destroy(): void {
    this._globalThemeDispose?.()
    this._globalThemeDispose = null
    this.cursors.destroy()
    this.motion.destroy()
    this.sound.destroy()

    //
    // Снимаем события с canvas.
    for (const [domEvent, handler] of Object.entries(this._boundCanvasEvents)) {
      this._canvas.element.removeEventListener(domEvent, handler)
    }

    //
    // Снимаем события с окна.
    for (const [domEvent, handler] of Object.entries(this._boundWindowEvents)) {
      window.removeEventListener(domEvent, handler)
    }

    this.bus.offAll()
    this.events.reset()
    this.components.clear()
    this.semantics.reset()

    this.stopLoop()
    this._debugger.stopDisplayMonitor()
    this._diagnostics.destroy()
    this.metrics.stop()

    for (const surface of this.surfaces) {
      surface.destroy()
    }
    this._backend.destroy()
    this._canvas.destroy()
    if (this._ownsSyncScope) {
      this.sync.dispose()
    }

    this.raph.clear()
    if (this._ownsRaphKernel) {
      this.raph.kernel.clear()
    }
  }

  /**
   * Подключает cleanup для глобального theme registry.
   */
  setGlobalThemeDispose(dispose: (() => void) | null): void {
    this._globalThemeDispose = dispose
  }

  /**
   * Включает или выключает backend-level retained diagnostics.
   */
  private _setRendererDiagnosticsEnabled(enabled: boolean): void {
    const backend = this._backend as NovaRendererDiagnosticsSwitch
    if (backend.diagnostics) {
      backend.diagnostics.enabled = enabled
    }
  }

  //
  // Зарегистрированные window event handlers для корректного destroy.
  private _boundWindowEvents: Record<string, (e: Event) => void> = {}

  //
  // Зарегистрированные canvas event handlers для корректного destroy.
  private _boundCanvasEvents: Record<string, (e: Event) => void> = {}

  /**
   * Подключает pointer и keyboard listeners согласно input options.
   */
  private _setupEventListeners(): void {
    //
    // Pointer events всегда живут на canvas, чтобы hit-test и координаты были в одной системе.
    if (this._inputOptions.pointer.enabled) {
      for (const domEvent of ['contextmenu', 'mousemove', 'mousedown', 'mouseup', 'wheel'] as const) {
        const handler = (e: Event) => {
          if (domEvent === 'mousedown') {
            this._keyboardActive = true
            this._focusCanvasKeyboardTarget()
          }

          if (domEvent === 'mousedown' || domEvent === 'mouseup') {
            this.sound.unlockFromInput()
          }

          const handled = this.handleEvent(domEvent, e)
          if (domEvent === 'wheel' && handled && (e as unknown as Record<string, unknown>).__novaAllowDefault !== true) {
            e.preventDefault()
          }
        }

        this._boundCanvasEvents[domEvent] = handler
        this._canvas.element.addEventListener(domEvent, handler, domEvent === 'wheel' ? { passive: false } : undefined)
      }

      //
      // Hover-состояние используется keyboard scope, когда клавиатура активна только над canvas.
      for (const domEvent of ['mouseenter', 'mouseleave'] as const) {
        const handler = (e: Event) => {
          this._keyboardHovered = domEvent === 'mouseenter'
          this.handleEvent(domEvent, e)
        }
        this._boundCanvasEvents[domEvent] = handler
        this._canvas.element.addEventListener(domEvent, handler)
      }
    }

    //
    // Manual keyboard scope полностью отдает подключение клавиатуры внешнему коду.
    if (!this._inputOptions.keyboard.enabled || this._inputOptions.keyboard.scope === 'manual') {
      return
    }

    const keyboardTarget = this._inputOptions.keyboard.scope === 'focused' ? this._canvas.element : window

    if (this._inputOptions.keyboard.scope === 'focused' && this._canvas.element.tabIndex < 0) {
      this._canvas.element.tabIndex = 0
    }

    //
    // Keyboard events регистрируются либо на canvas, либо на window в зависимости от scope.
    for (const domEvent of ['keydown', 'keyup'] as const) {
      const handler = (e: Event) => {
        const keyboardEvent = e as KeyboardEvent
        if (!this._shouldHandleKeyboardEvent(keyboardEvent)) {
          return
        }

        if (domEvent === 'keydown') {
          this.sound.unlockFromInput()
        }

        const handled = this.handleEvent(domEvent, keyboardEvent)
        this._applyKeyboardPreventDefault(keyboardEvent, handled)
      }

      const registry = keyboardTarget === window ? this._boundWindowEvents : this._boundCanvasEvents
      registry[domEvent] = handler
      keyboardTarget.addEventListener(domEvent, handler)
    }

    if (this._inputOptions.keyboard.scope === 'active') {
      const handler = (e: Event) => {
        if (e.target !== this._canvas.element) {
          this._keyboardActive = false
        }
      }
      this._boundWindowEvents.mousedown = handler
      window.addEventListener('mousedown', handler)
    }
  }

  /**
   * Переводит DOM focus на canvas для focused keyboard scope.
   */
  private _focusCanvasKeyboardTarget(): void {
    if (!this._inputOptions.keyboard.enabled || this._inputOptions.keyboard.scope !== 'focused') {
      return
    }
    this._canvas.element.focus({ preventScroll: true })
  }

  /**
   * Нормализует пользовательские input options в полный resolved config.
   */
  private _resolveInputOptions(options: NovaInputOptions = {}): ResolvedNovaInputOptions {
    return {
      pointer: {
        enabled: options.pointer?.enabled ?? true,
        capture: options.pointer?.capture ?? true,
      },
      keyboard: {
        enabled: options.keyboard?.enabled ?? true,
        scope: options.keyboard?.scope ?? 'focused',
        preventDefault: options.keyboard?.preventDefault ?? 'handled',
        ignoreEditableTargets: options.keyboard?.ignoreEditableTargets ?? true,
      },
    }
  }

  /**
   * Проверяет, должен ли NovaApp обрабатывать конкретное keyboard event.
   */
  private _shouldHandleKeyboardEvent(event: KeyboardEvent): boolean {
    const options = this._inputOptions.keyboard

    if (options.ignoreEditableTargets && this._isEditableTarget(event.target)) {
      return false
    }

    if (options.scope === 'global' || options.scope === 'focused') {
      return true
    }

    if (options.scope === 'active') {
      return this._keyboardActive
    }

    if (options.scope === 'hovered') {
      return this._keyboardHovered
    }

    return false
  }

  /**
   * Применяет preventDefault для keyboard event согласно настройкам input.
   */
  private _applyKeyboardPreventDefault(event: KeyboardEvent, handled: boolean): void {
    const preventDefault = this._inputOptions.keyboard.preventDefault

    if (preventDefault === 'always' || (preventDefault === 'handled' && handled)) {
      event.preventDefault()
    }
  }

  /**
   * Проверяет, является ли target редактируемым DOM-элементом.
   */
  private _isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false
    }

    const tagName = target.tagName.toLowerCase()
    return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
  }
}

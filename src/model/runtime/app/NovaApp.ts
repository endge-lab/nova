import type { EventList } from '@endge/utils'
import { EventBus } from '@endge/utils'
import type { RaphApp, RaphLocalPhaseContext , RaphNode } from '@endge/raph'
import { Raph, RaphLocalPhase, RaphSchedulerType } from '@endge/raph'
import { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import type {
    NovaAppCreateOptions,
    NovaAppOptions,
    NovaDebugOptions,
    NovaInputOptions,
    NovaNodeProperties,
    ResolvedNovaInputOptions,
    NovaSizeOptions,
} from '@/domain/types/base.types'
import type { NovaNodeEventHandlers } from '@/domain/types/events.types'
import { NovaStore } from '@/model/runtime/state/NovaStore'
import { NovaCanvas } from '@/model/platform/NovaCanvas'
import { RendererType } from '@/domain/types/renderer.types'
import type { NovaHitTestMode } from '@/domain/types/renderer.types'
import { NovaNode } from '@/model/runtime/tree/NovaNode'
import { NovaEvents } from '@/model/runtime/interaction/NovaEvents'
import { NovaCursorManager } from '@/model/runtime/cursor/NovaCursorManager'
import { NovaDebug } from '@/model/runtime/debug/NovaDebug'
import { NovaMetrics } from '@/model/runtime/debug/NovaMetrics'
import { Telemetry } from '@/model/telemetry'
import type { NovaScene } from '@/model/runtime/scene/NovaScene'
import { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import { NovaComponentRegistry } from '@/model/runtime/components/NovaComponentRegistry'
import { NovaMotionEngine } from '@/model/motion/NovaMotionEngine'
import { NovaSoundEngine } from '@/model/sound/NovaSoundEngine'
import { NovaThemeService } from '@/model/theme/NovaThemeService'
import type { NovaRendererConfig, NovaRendererConfigInput } from '@/domain/types/rendering/index'
import { resolveNovaRendererConfig } from '@/model/render/policy/NovaRenderPolicy'
import { NovaPhase } from '@/domain/constants/NovaPhase'
import { createNovaRaphRuntime } from '@/model/runtime/app/createNovaRaphRuntime'
import type { NovaRenderBackend } from '@/model/render/backends/NovaRenderBackend'
import { createNovaRenderBackend } from '@/model/render/backends/NovaRenderBackendFactory'
import { NovaRenderOrchestrator } from '@/model/render/orchestration/NovaRenderOrchestrator'

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
    readonly metrics: NovaMetrics

    //
    // Текущее состояние debug-конфигурации.
    private _debugOptions: NovaDebugOptions = { enabled: false }

    //
    // Внутренний debugger и состояние keyboard routing.
    private readonly _debugger = new NovaDebug()
    private _keyboardActive = false
    private _keyboardHovered = false
    private _contextVersion = 0

    /**
     * Создает приложение, подключает canvas, input, renderer и Raph-loop.
     */
    constructor(options: NovaAppCreateOptions<E>) {
        if (!(options.target instanceof HTMLCanvasElement)) {
            throw new Error('NovaApp target must be an HTMLCanvasElement')
        }

        //
        // Сначала нормализуем базовую конфигурацию, потому что от нее зависит canvas и renderer.
        this._inputOptions = this.resolveInputOptions(options.input)
        this._webglAttributes = options.renderer?.webgl
        this._mainRendererType = options.renderer?.main ?? RendererType.Web2D
        this._rendererConfig = resolveNovaRendererConfig(options.renderer?.config)
        this._canvas = NovaCanvas.attach(options.target, {
            ...options.size,
            webgl: this._webglAttributes,
            contextType: this._mainRendererType,
        })

        //
        // Создаем registry, backend и event system, которые дальше используют surfaces и nodes.
        this.schema = options.schemaRegistry ?? new NovaSchemaRegistry()
        this._backend = createNovaRenderBackend(this._mainRendererType, this._canvas, this.schema, this._rendererConfig)
        this._orchestrator = new NovaRenderOrchestrator(this._backend)
        this._events = new NovaEvents(this)
        this.sound = new NovaSoundEngine(this, options.sound)
        this.cursors = new NovaCursorManager(this)

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
        this.setupEventListeners()

        //
        // Инициализируем Raph core и root node.
        this._ownsRaphKernel = !options.raph?.kernel
        this._raph = createNovaRaphRuntime(this, {
            kernel: options.raph?.kernel,
            runtimeId: options.raph?.runtimeId,
            scheduler: options.scheduler?.type ?? RaphSchedulerType.AnimationFrame,
        })
        this.theme = new NovaThemeService(this, options.theme)
        this.metrics = new NovaMetrics(() => this.raph.UPS)
        this.resize(options.size)
        this.metrics.start()

        if (options.scheduler?.loop) {
            this.startLoop()
        } else {
            this.raph.invalidate()
        }
    }

    /**
     * Запускает начало кадра, motion engine и frame-level diagnostics.
     */
    @RaphLocalPhase({ name: NovaPhase.Before, priority: -1, always: true })
    before(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
        this.metrics.markFrameStart()
        this._debugger.frameStart()
        this.motion.tick(p.frame)
    }

    /**
     * Выполняет preupdate-фазу для dirty nodes.
     */
    @RaphLocalPhase({ name: NovaPhase.PreUpdate, priority: 0 })
    preupdate(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
        this._debugger.phaseStart('preupdate')
        Raph.processDirtyNodes({ payload: p })
        this._debugger.phaseEnd()
    }

    /**
     * Выполняет update-фазу для dirty nodes.
     */
    @RaphLocalPhase({ name: NovaPhase.Update, priority: 1 })
    update(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
        this._debugger.phaseStart('update')
        Raph.processDirtyNodes({ payload: p })
        this._debugger.phaseEnd()
    }

    /**
     * Выполняет matrix-фазу и обновляет transform state dirty nodes.
     */
    @RaphLocalPhase({ name: NovaPhase.Matrix, priority: 2 })
    matrix(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
        this._debugger.phaseStart('matrix')
        Raph.processDirtyNodes({ payload: p })
        this._debugger.phaseEnd()
    }

    /**
     * Собирает dirty surfaces и запускает render от корня каждого surface.
     */
    @RaphLocalPhase({ name: NovaPhase.Render, priority: 3, mode: 'dirty' })
    render(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
        this._debugger.phaseStart('render')

        const dirtySurfaces = new Set<NovaSurface<E>>()

        for (const node of p.dirty) {
            for (const prop of p.phase.properties) {
                prop.computeOn(node)
            }

            if (node instanceof NovaSurface) {
                node.markRenderFrameDirty(true)
                dirtySurfaces.add(node)
            } else if (node instanceof NovaNode) {
                node.markRenderFrameDirty(false)
                dirtySurfaces.add(node.surface)
            }
        }

        for (const surface of dirtySurfaces) {
            this._dirtySurfaces.add(surface)
        }

        this._debugger.phaseEnd()
    }

    /**
     * Компилирует dirty surfaces и replay-ит все retained frames в основной canvas.
     */
    @RaphLocalPhase({ name: NovaPhase.Flush, priority: 4 })
    flush(): void {
        this._debugger.phaseStart('flush')

        this._orchestrator.render(this.getOrderedSurfaces(), this._dirtySurfaces)
        this._dirtySurfaces.clear()

        //
        // Mark rendered frame нужен метрикам даже тогда, когда Web2D flush не выполнялся.
        this._debugger.markRenderedFrame()
        this.metrics.markDraw()

        //
        // Закрываем debug-фазу после всех операций кадра.
        this._debugger.phaseEnd()
    }

    /**
     * Завершает кадр и обновляет frame-level metrics.
     */
    @RaphLocalPhase({ name: NovaPhase.After, priority: 10, always: true })
    after(): void {
        this._debugger.frameEnd()
        this.metrics.markFrameEnd()
    }

    /**
     * Планирует выполнение Raph-фаз при наличии dirty nodes.
     */
    invalidate(): void {
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
            } else {
                this._debugger.stopDisplayMonitor()
            }
        }

        if (opts.loop !== undefined && opts.loop !== this.raph.loopEnabled) {
            if (opts.loop) {
                this.startLoop()
            } else {
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
     * Возвращает runtime debugger приложения.
     */
    get debugger(): NovaDebug {
        return this._debugger
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
        this.ensureSurfaceOrder(surface)

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
     * Возвращает surfaces в порядке compositing.
     */
    private getOrderedSurfaces(): Array<NovaSurface<E>> {
        this._orderedSurfaces.length = 0

        for (const surface of this.surfaces) {
            this.ensureSurfaceOrder(surface)
            this._orderedSurfaces.push(surface)
        }

        //
        // Больший zIndex surface композитится позже и оказывается выше.
        // При равном zIndex сохраняем порядок добавления слоев.
        this._orderedSurfaces.sort((a, b) => {
            const weightDiff = a.weight - b.weight
            if (weightDiff !== 0) return weightDiff
            return this.surfaceOrderOf(a) - this.surfaceOrderOf(b)
        })

        return this._orderedSurfaces
    }

    /**
     * Фиксирует стабильный порядок добавления surface, если он еще не был сохранен.
     */
    private ensureSurfaceOrder(surface: NovaSurface<E>): void {
        if (this._surfaceOrder.has(surface)) return
        this._surfaceOrder.set(surface, this._surfaceOrderCounter++)
    }

    /**
     * Возвращает стабильный индекс добавления surface.
     */
    private surfaceOrderOf(surface: NovaSurface<E>): number {
        this.ensureSurfaceOrder(surface)
        return this._surfaceOrder.get(surface)!
    }

    /**
     * Регистрирует node в интерактивном индексе событий.
     */
    registerInteractiveNode(node: NovaNode<E>): void {
        this._events.interactiveNodes.add(node)
        this._events.markSpatialDirty(node)
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
        if (a === b) return 0
        if (a.surface !== b.surface) {
            const weightDiff = a.surface.weight - b.surface.weight
            if (weightDiff !== 0) return weightDiff
            return this.surfaceOrderOf(a.surface) - this.surfaceOrderOf(b.surface)
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
            if (diff !== 0) return diff
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
        const path = this.getRenderPath(node)
        const stamp: Array<number> = [node.surface.weight, this.surfaceOrderOf(node.surface)]

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
    private getRenderPath(node: NovaNode<E>): Array<NovaNode<E>> {
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

        this.stopLoop()
        this._debugger.stopDisplayMonitor()
        this.metrics.stop()

        for (const surface of this.surfaces) {
            surface.destroy()
        }
        this._backend.destroy()
        this._canvas.destroy()

        this.raph.clear()
        if (this._ownsRaphKernel) {
            this.raph.kernel.clear()
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
    private setupEventListeners(): void {

        //
        // Pointer events всегда живут на canvas, чтобы hit-test и координаты были в одной системе.
        if (this._inputOptions.pointer.enabled) {
            for (const domEvent of ['contextmenu', 'mousemove', 'mousedown', 'mouseup', 'wheel'] as const) {
                const handler = (e: Event) => {
                    if (domEvent === 'mousedown') {
                        this._keyboardActive = true
                    }

                    if (domEvent === 'mousedown' || domEvent === 'mouseup') {
                        this.sound.unlockFromInput()
                    }

                    const handled = this.handleEvent(domEvent, e)
                    if (domEvent === 'wheel' && handled) {
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
                if (!this.shouldHandleKeyboardEvent(keyboardEvent)) {
                    return
                }

                if (domEvent === 'keydown') {
                    this.sound.unlockFromInput()
                }

                const handled = this.handleEvent(domEvent, keyboardEvent)
                this.applyKeyboardPreventDefault(keyboardEvent, handled)
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
     * Нормализует пользовательские input options в полный resolved config.
     */
    private resolveInputOptions(options: NovaInputOptions = {}): ResolvedNovaInputOptions {
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
    private shouldHandleKeyboardEvent(event: KeyboardEvent): boolean {
        const options = this._inputOptions.keyboard

        if (options.ignoreEditableTargets && this.isEditableTarget(event.target)) {
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
    private applyKeyboardPreventDefault(event: KeyboardEvent, handled: boolean): void {
        const preventDefault = this._inputOptions.keyboard.preventDefault

        if (preventDefault === 'always' || (preventDefault === 'handled' && handled)) {
            event.preventDefault()
        }
    }

    /**
     * Проверяет, является ли target редактируемым DOM-элементом.
     */
    private isEditableTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false

        const tagName = target.tagName.toLowerCase()
        return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
    }
}

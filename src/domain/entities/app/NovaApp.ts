import { NovaSurface } from '@/domain/entities/core/NovaSurface'
import { NovaRenderer2D } from '@/domain/entities/graphics/NovaRenderer2D'
import type {
  NovaAppCreateOptions,
  NovaAppOptions,
  NovaInputOptions,
  NovaNodeProperties,
  ResolvedNovaInputOptions,
  NovaSizeOptions,
} from '@/domain/types/base-types'
import type { NovaNodeEventHandlers } from '@/domain/types/events-types'
import { NovaStore } from '@/domain/entities/core/NovaStore'
import type { EventList } from '@endge/utils'
import { EventBus } from '@endge/utils'
import { NovaCanvas } from '@/domain/entities/graphics/NovaCanvas'
import { RendererType } from '@/domain/types/renderer-types'
import type { NovaHitTestMode } from '@/domain/types/renderer-types'
import type { RaphApp, RaphLocalPhaseContext } from '@endge/raph'
import { Raph, RaphLocalPhase, RaphSchedulerType } from '@endge/raph'
import { NovaNode } from '@/domain/entities/core/NovaNode'
import { NovaEvents } from '@/domain/entities/core/NovaEvents'
import { NovaDebug } from '@/domain/entities/app/NovaDebug'
import { Telemetry } from '@/domain/telemetry'
import type { RaphNode } from '@endge/raph'
import type { NovaScene } from '@/domain/entities/core/NovaScene'
import { NovaSchemaRegistry } from '@/domain/entities/core/NovaSchemaRegistry'
import { NovaComponentRegistry } from '@/domain/entities/core/NovaComponentRegistry'
import { NovaMotionEngine } from '@/domain/entities/motion/NovaMotionEngine'

export class NovaApp<E extends EventList = Record<string, any>> {
  // Ядро
  private readonly _raph: RaphApp<NovaNodeProperties>
  private readonly _canvas: NovaCanvas
  private readonly _renderer: NovaRenderer2D
  private readonly _events: NovaEvents<E>
  private readonly _inputOptions: ResolvedNovaInputOptions
  private readonly _webglAttributes?: WebGLContextAttributes
  private readonly _surfaceOrder = new WeakMap<NovaSurface<E>, number>()
  private readonly _orderedSurfaces: Array<NovaSurface<E>> = []
  private _surfaceOrderCounter = 0

  readonly store = new NovaStore()
  readonly schema: NovaSchemaRegistry
  readonly components = new NovaComponentRegistry()
  readonly motion = new NovaMotionEngine(this)
  readonly bus: EventBus<E>

  // NovaAppOptions
  private _debug: boolean | string | string[] = false

  // Системные
  __tasks = 0
  __groups = 0
  private readonly __debugger = new NovaDebug()
  private _keyboardActive = false
  private _keyboardHovered = false

  //
  // CTOR
  //

  constructor(options: NovaAppCreateOptions<E>) {
    if (!(options.target instanceof HTMLCanvasElement)) {
      throw new Error('NovaApp target must be an HTMLCanvasElement')
    }

    if (options.renderer?.main !== undefined && options.renderer.main !== RendererType.Web2D) {
      throw new Error('NovaApp main renderer supports only Canvas2D target at the moment')
    }

    this._inputOptions = this.resolveInputOptions(options.input)
    this._webglAttributes = options.renderer?.webgl
    this._canvas = NovaCanvas.attach(options.target, {
      ...options.size,
      webgl: this._webglAttributes,
    })
    this.schema = options.schemaRegistry ?? new NovaSchemaRegistry()
    this._renderer = new NovaRenderer2D(this._canvas, this.schema)
    this._events = new NovaEvents(this)

    this.bus = new EventBus<E>(options.predefinedEvents ?? [])
    this._debug = options.debug?.enabled ?? false
    this.__debugger.enabled = this._debug === true
    if (this._debug) {
      this.__debugger.startDisplayMonitor()
    }
    if (options.debug?.telemetry !== undefined) {
      Telemetry.enabled = options.debug.telemetry
    }

    // events
    this.setupEventListeners()

    // Raph core
    const conf = Raph.configureLocal<NovaNodeProperties, NovaApp<E>, NovaNode<E>>(
      () => this,
      () => new NovaNode(this),
    )
    this._raph = conf.app
    this.raph.setScheduler(options.scheduler?.type ?? RaphSchedulerType.AnimationFrame)
    this.raph.init()
    this.resize(options.size)

    if (options.scheduler?.loop) {
      this.startLoop()
    } else {
      this.raph.invalidate()
    }
  }

  //
  // RAPH CORE
  //
  @RaphLocalPhase({ name: 'before', priority: -1, always: true })
  before(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this.__debugger.frameStart()
    this.motion.tick(p.frame)
  }

  @RaphLocalPhase({ name: 'preupdate', priority: 0 })
  preupdate(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this.__debugger.phaseStart('preupdate')
    Raph.processDirtyNodes({ payload: p })
    this.__debugger.phaseEnd()
  }

  @RaphLocalPhase({ name: 'update', priority: 1 })
  update(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this.__debugger.phaseStart('update')
    Raph.processDirtyNodes({ payload: p })
    this.__debugger.phaseEnd()
  }

  @RaphLocalPhase({ name: 'matrix', priority: 2 })
  matrix(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this.__debugger.phaseStart('matrix')
    Raph.processDirtyNodes({ payload: p })
    this.__debugger.phaseEnd()
  }

  @RaphLocalPhase({ name: 'render', priority: 3, mode: 'dirty' })
  render(p: RaphLocalPhaseContext<NovaNodeProperties>): void {
    this.__debugger.phaseStart('render')

    const dirtySurfaces = new Set<NovaSurface<E>>()

    for (const node of p.dirty) {
      for (const prop of p.phase.properties) {
        prop.computeOn(node)
      }

      if (node instanceof NovaSurface) {
        dirtySurfaces.add(node)
      } else if (node instanceof NovaNode) {
        dirtySurfaces.add(node.surface)
      }
    }

    // Render всегда идет от корня surface, чтобы дочерние dirty-ноды
    // не рисовались поверх уже собранного слоя повторно.
    for (const surface of dirtySurfaces) {
      surface.doRender()
    }

    this.__debugger.phaseEnd()
  }

  @RaphLocalPhase({ name: 'flush', priority: 4 })
  flush(): void {
    this.__debugger.phaseStart('flush')

    this._renderer.clear()
    const ctx = this.canvas.getContext2D()!
    for (const surface of this.getOrderedSurfaces()) {
      surface.doFlush(ctx)
    }
    this.__debugger.markRenderedFrame()

    if (this._debug) {
      const fps = this.__debugger.displayFps
      this._renderer.schema([
        {
          type: 'text',
          text: `${!this.raph.loopEnabled ? 'LAST ' : ''}FPS: ${fps.toFixed(0)} (Задач: ${this.__tasks}, Групп: ${this.__groups})`,
          x: this.width - 300,
          y: 5,
          width: 300,
          height: 10,
          styles: {
            ellipsis: true,
            align: { horizontal: 'center', vertical: 'middle' },
            font: { family: 'monospace', size: 10 },
          },
        },
      ])
    }

    this.__debugger.phaseEnd()
  }

  @RaphLocalPhase({ name: 'after', priority: 10, always: true })
  after(): void {
    this.__debugger.frameEnd()
  }

  // При наличии изменений запустит нужные фазы у нужных узлов.
  // (Сам по себе не несет нагрузки, если нет изменений)
  invalidate(): void {
    this.raph.invalidate()
  }

  startLoop(): void {
    this.raph.startLoop()
  }

  stopLoop(): void {
    this.raph.stopLoop()
  }

  options(opts: Partial<NovaAppOptions>): void {
    if (opts.debug !== undefined) {
      this._debug = opts.debug
      this.__debugger.enabled = opts.debug === true
      if (opts.debug) {
        this.__debugger.startDisplayMonitor()
      } else {
        this.__debugger.stopDisplayMonitor()
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

  handleEvent(type: keyof NovaNodeEventHandlers, event: Event): boolean {
    return this._events.handle(type, event)
  }

  setHitTestMode(mode: NovaHitTestMode): void {
    this._events.hitTestMode = mode
  }

  createScene<T extends NovaScene<E>>(SceneClass: new (app: NovaApp<E>, ...args: any[]) => T, ...args: any[]): T {
    const scene = new SceneClass(this, ...args)
    scene.mount()
    return scene
  }

  //
  // PROPERTIES
  //

  get raph(): RaphApp<NovaNodeProperties> {
    return this._raph
  }

  get canvas(): NovaCanvas {
    return this._canvas
  }

  get renderer(): NovaRenderer2D {
    return this._renderer
  }

  get events(): NovaEvents<E> {
    return this._events
  }

  get surfaces(): NovaSurface<E>[] {
    return this.raph.root.children as unknown as NovaSurface<E>[]
  }

  get debugger(): NovaDebug {
    return this.__debugger
  }

  get width(): number {
    return this.raph.root.get('width')
  }

  get height(): number {
    return this.raph.root.get('height')
  }

  get dpr(): number {
    return this.canvas.dpr
  }

  get maxDpr(): number {
    return this.canvas.maxDpr
  }

  get webglAttributes(): WebGLContextAttributes | undefined {
    return this._webglAttributes
  }

  get inputOptions(): ResolvedNovaInputOptions {
    return this._inputOptions
  }

  //
  // STATE
  //

  createSurface2D<T extends NovaSurface<E>>(
    name: string,
    SurfaceClass: new (...args: any[]) => T = NovaSurface<E> as any,
    ...args: any[]
  ): T {
    const surface = new SurfaceClass(name, this, RendererType.Web2D, ...args)
    return this.addSurface(surface)
  }

  createSurfaceWebGL<T extends NovaSurface<E>>(
    name: string,
    SurfaceClass: new (...args: any[]) => T = NovaSurface as any,
    ...args: any[]
  ): T {
    const surface = new SurfaceClass(name, this, RendererType.WebGL, ...args)
    return this.addSurface(surface)
  }

  addSurface<T extends NovaSurface<E>>(surface: T): T {
    this.ensureSurfaceOrder(surface)

    // Применяем базовые размеры.
    surface.options({
      width: this.width,
      height: this.height,
    })

    // Добавляем в RaphGraph
    this.raph.addNode(surface as unknown as RaphNode<NovaNodeProperties>)
    surface.mountSubtree()
    this.invalidate()

    return surface
  }

  private getOrderedSurfaces(): Array<NovaSurface<E>> {
    this._orderedSurfaces.length = 0

    for (const surface of this.surfaces) {
      this.ensureSurfaceOrder(surface)
      this._orderedSurfaces.push(surface)
    }

    // Больший zIndex surface композитится позже и оказывается выше.
    // При равном zIndex сохраняем порядок добавления слоев.
    this._orderedSurfaces.sort((a, b) => {
      const weightDiff = a.weight - b.weight
      if (weightDiff !== 0) return weightDiff
      return this.surfaceOrderOf(a) - this.surfaceOrderOf(b)
    })

    return this._orderedSurfaces
  }

  private ensureSurfaceOrder(surface: NovaSurface<E>): void {
    if (this._surfaceOrder.has(surface)) return
    this._surfaceOrder.set(surface, this._surfaceOrderCounter++)
  }

  private surfaceOrderOf(surface: NovaSurface<E>): number {
    this.ensureSurfaceOrder(surface)
    return this._surfaceOrder.get(surface)!
  }

  registerInteractiveNode(node: NovaNode<E>): void {
    this._events.interactiveNodes.add(node)
    this._events.markSpatialDirty(node)
  }

  unregisterInteractiveNode(node: NovaNode<E>): void {
    this._events.removeNodeReferences(node)
  }

  compareRenderOrder(a: NovaNode<E>, b: NovaNode<E>): number {
    if (a === b) return 0
    if (a.surface !== b.surface) {
      const weightDiff = a.surface.weight - b.surface.weight
      if (weightDiff !== 0) return weightDiff
      return this.surfaceOrderOf(a.surface) - this.surfaceOrderOf(b.surface)
    }

    const aStamp = this.getRenderOrderStamp(a)
    const bStamp = this.getRenderOrderStamp(b)
    const min = Math.min(aStamp.length, bStamp.length)

    for (let index = 0; index < min; index++) {
      const diff = aStamp[index] - bStamp[index]
      if (diff !== 0) return diff
    }

    return aStamp.length - bStamp.length
  }

  getRenderOrderStamp(node: NovaNode<E>): number[] {
    const path = this.getRenderPath(node)
    const stamp: number[] = [node.surface.weight, this.surfaceOrderOf(node.surface)]

    for (let index = 1; index < path.length; index++) {
      const current = path[index]
      const parent = path[index - 1]
      stamp.push(current.weight, parent.renderOrderIndexOf(current))
    }

    return stamp
  }

  private getRenderPath(node: NovaNode<E>): Array<NovaNode<E>> {
    const path: Array<NovaNode<E>> = []
    let current: unknown = node

    while (current instanceof NovaNode) {
      path.unshift(current)
      current = current.parent
    }

    return path
  }

  resize(size: Partial<NovaSizeOptions> = {}): void {
    const root = this.raph.root!

    const newWidth = size.width ?? root.get('width') ?? this.canvas.width
    const newHeight = size.height ?? root.get('height') ?? this.canvas.height

    root.set('width', newWidth)
    root.set('height', newHeight)

    this._canvas.resize(newWidth, newHeight, {
      dpr: size.dpr,
      maxDpr: size.maxDpr,
    })

    for (const surface of this.surfaces) {
      surface.options({ width: newWidth, height: newHeight })
      surface.dirty({ update: true, matrix: true, render: true })
    }

    this.raph.invalidate()
  }

  destroy(): void {
    this.motion.destroy()

    // Снимаем события с canvas
    for (const [domEvent, handler] of Object.entries(this._boundCanvasEvents)) {
      this._canvas.element.removeEventListener(domEvent, handler)
    }

    // Снимаем события с окна
    for (const [domEvent, handler] of Object.entries(this._boundWindowEvents)) {
      window.removeEventListener(domEvent, handler)
    }

    this.bus.offAll()
    this.events.reset()
    this.components.clear()

    this.stopLoop()
    this.__debugger.stopDisplayMonitor()

    this._canvas.destroy()
    for (const surface of this.surfaces) {
      surface.destroy()
    }

    this.raph.clear()
  }

  //
  // SYSTEM
  //

  private _boundWindowEvents: Record<string, (e: Event) => void> = {}
  private _boundCanvasEvents: Record<string, (e: Event) => void> = {}

  private setupEventListeners(): void {
    if (this._inputOptions.pointer.enabled) {
      for (const domEvent of ['contextmenu', 'mousemove', 'mousedown', 'mouseup', 'wheel'] as const) {
        const handler = (e: Event) => {
          if (domEvent === 'mousedown') {
            this._keyboardActive = true
          }

          const handled = this.handleEvent(domEvent, e)
          if (domEvent === 'wheel' && handled) {
            e.preventDefault()
          }
        }

        this._boundCanvasEvents[domEvent] = handler
        this._canvas.element.addEventListener(domEvent, handler, domEvent === 'wheel' ? { passive: false } : undefined)
      }

      for (const domEvent of ['mouseenter', 'mouseleave'] as const) {
        const handler = (e: Event) => {
          this._keyboardHovered = domEvent === 'mouseenter'
          this.handleEvent(domEvent, e)
        }
        this._boundCanvasEvents[domEvent] = handler
        this._canvas.element.addEventListener(domEvent, handler)
      }
    }

    if (!this._inputOptions.keyboard.enabled || this._inputOptions.keyboard.scope === 'manual') {
      return
    }

    const keyboardTarget = this._inputOptions.keyboard.scope === 'focused' ? this._canvas.element : window

    if (this._inputOptions.keyboard.scope === 'focused' && this._canvas.element.tabIndex < 0) {
      this._canvas.element.tabIndex = 0
    }

    for (const domEvent of ['keydown', 'keyup'] as const) {
      const handler = (e: Event) => {
        const keyboardEvent = e as KeyboardEvent
        if (!this.shouldHandleKeyboardEvent(keyboardEvent)) {
          return
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

  private applyKeyboardPreventDefault(event: KeyboardEvent, handled: boolean): void {
    const preventDefault = this._inputOptions.keyboard.preventDefault

    if (preventDefault === 'always' || (preventDefault === 'handled' && handled)) {
      event.preventDefault()
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false

    const tagName = target.tagName.toLowerCase()
    return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
  }
}

import { mat3 } from 'gl-matrix'
import { RaphNode , RaphPropagation , RaphAfter, RaphProperty } from '@endge/raph'
import type { DataPathDef , RaphApp } from '@endge/raph'
import type { OneOrMany , EventList } from '@endge/utils'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import type { NovaCursorContext, NovaCursorDeclaration } from '@/domain/types/cursor.types'
import type { NovaNodeEventHandlers } from '@/domain/types/events.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type { NovaBounds, NovaLifecycleState, NovaRenderer, NovaSchema } from '@/domain/types/renderer.types'
import type { NovaEvents } from '@/model/runtime/interaction/NovaEvents'
import type { NovaDebug } from '@/model/runtime/debug/NovaDebug'
import type { NovaNodeSoundMap, NovaSoundCueInput, NovaSoundHandle } from '@/domain/types/sound.types'
import { boundsEquals, boundsIntersects, copyBounds, createEmptyBounds, transformBounds } from '@/domain/utils/bounds'
import { resolveSchemaBounds } from '@/domain/utils/schemaBounds'
import type {
  NovaRenderDirtyFlags,
  NovaRenderPolicy,
  NovaRenderPolicyInput,
  NovaRenderVersions,
} from '@/domain/types/rendering/index'
import {
  bumpRenderVersions,
  createCleanRenderDirtyFlags,
  createRenderVersions,
  mergeRenderDirtyFlags,
  resolveNovaRenderPolicy,
} from '@/model/render/policy/NovaRenderPolicy'
import { NovaPhase } from '@/domain/constants/NovaPhase'
import type {
  NovaAddChildOptions,
  NovaContextToken,
  NovaObserveDataOptions,
} from '@/domain/types/context.types'

/**
 * Описывает контракт NovaRenderNodeAwareRenderer.
 */
interface NovaRenderNodeAwareRenderer {
  beginNode(node: NovaNode<any>): void
  endNode(node: NovaNode<any>): void
}

/**
 * Описывает cache entry для найденного scoped provider.
 */
interface NovaInjectCacheEntry<T> {
  provider: NovaNode<any>
  providerVersion: number
  scopeVersion: number
  value: T
}

/**
 * Описывает результат поиска scoped provider.
 */
interface NovaContextLookup<T> {
  found: boolean
  value?: T
}

/**
 * Проверяет наличие spatial options.
 */
function hasSpatialOptions(opts: Partial<NovaNodeProperties> & { zIndex?: number }): boolean {
  return (
    opts.x !== undefined
    || opts.y !== undefined
    || opts.width !== undefined
    || opts.height !== undefined
    || opts.scaleX !== undefined
    || opts.scaleY !== undefined
    || opts.rotation !== undefined
    || opts.active !== undefined
    || opts.visible !== undefined
    || opts.opacity !== undefined
    || opts.interactive !== undefined
    || opts.cursor !== undefined
    || opts.zIndex !== undefined
  )
}

/**
 * Описывает базовый узел Nova tree с состоянием, transform, lifecycle и rendering hooks.
 */
export class NovaNode<
  E extends EventList,
> extends RaphNode<NovaNodeProperties> {
  //
  // Внутреннее состояние graph runtime и lifecycle.
  protected readonly _nova: NovaApp<E>
  protected readonly _surface?: NovaSurface<E>

  readonly eventHandlers: Partial<NovaNodeEventHandlers> = {}
  readonly captureEventHandlers: Partial<NovaNodeEventHandlers> = {}
  __type: string
  private readonly _inverseMatrix = mat3.create()
  private _inverseMatrixSource?: mat3
  private readonly _renderOrder = new WeakMap<NovaNode<E>, number>()
  private readonly _orderedChildren: Array<NovaNode<E>> = []
  private readonly _localRenderBounds = createEmptyBounds()
  private _renderOrderCounter = 0
  private _renderFrameDirty = true
  private _lifecycleState: NovaLifecycleState = 'created'
  private _hasLocalRenderBounds = false
  private _renderPolicy: NovaRenderPolicy = resolveNovaRenderPolicy()
  private readonly _renderDirtyFlags: NovaRenderDirtyFlags = createCleanRenderDirtyFlags()
  private readonly _renderVersions: NovaRenderVersions = createRenderVersions()
  private _provides?: Map<NovaContextToken<any>, any>
  private _injectCache?: Map<NovaContextToken<any>, NovaInjectCacheEntry<any>>
  private _providerVersion = 0
  private _nodeContext?: unknown
  private _hasNodeContext = false
  private readonly _disposers: Array<() => void> = []
  private readonly _soundHandles = new Set<NovaSoundHandle>()
  private readonly _soundUserHandlers = new Map<keyof NovaNodeEventHandlers, unknown>()
  private _soundEventBindings?: Map<keyof NovaNodeEventHandlers, NovaSoundCueInput>

  //
  // CTOR
  //

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(app: NovaApp<E>, surface?: NovaSurface<E>) {
    super(app.raph)
    this._nova = app
    this._surface = surface
    this.__type = this.constructor.name
  }

  /**
   * Регистрирует scoped dependency для потомков этой ноды.
   */
  provide<T>(token: NovaContextToken<T>, value: T): this {
    if (!this._provides) {
      this._provides = new Map()
    }

    this._provides.set(token, value)
    this._providerVersion += 1
    this.nova.bumpContextVersion()
    this._injectCache?.delete(token)
    return this
  }

  /**
   * Возвращает scoped dependency из ближайшего ancestor provider.
   */
  inject<T>(token: NovaContextToken<T>): T {
    const result = this.resolveInjectedValue(token)
    if (result.found) {
      return result.value as T
    }

    throw new Error(`[NovaNode] Context provider not found for "${String(token.description ?? token.toString())}"`)
  }

  /**
   * Возвращает scoped dependency или fallback, если provider не найден.
   */
  injectOptional<T>(token: NovaContextToken<T>, fallback?: T): T | undefined {
    const result = this.resolveInjectedValue(token)
    return result.found ? result.value as T : fallback
  }

  /**
   * Проверяет, зарегистрирован ли provider на этой ноде.
   */
  hasProvider<T>(token: NovaContextToken<T>): boolean {
    return this._provides?.has(token) ?? false
  }

  /**
   * Устанавливает явный runtime context этой ноды.
   */
  setContext<T>(context: T): this {
    this._nodeContext = context
    this._hasNodeContext = true
    return this
  }

  /**
   * Возвращает явный runtime context этой ноды.
   */
  getContext<T>(): T {
    if (!this._hasNodeContext) {
      throw new Error(`[NovaNode] Node context is not set for "${this.id}"`)
    }

    return this._nodeContext as T
  }

  /**
   * Возвращает явный runtime context или fallback.
   */
  getContextOptional<T>(fallback?: T): T | undefined {
    return this._hasNodeContext ? this._nodeContext as T : fallback
  }

  /**
   * Добавляет disposer, который будет вызван при dispose ноды.
   */
  addDisposer(disposer: () => void): () => void {
    this._disposers.push(disposer)
    return disposer
  }

  /**
   * Подписывает ноду на business data path и dirty-ит указанную Nova phase.
   */
  observeData(path: DataPathDef, options: NovaObserveDataOptions = {}): () => void {
    const phase = options.phase ?? NovaPhase.Update
    const dispose = this.raph.observeData(this, path, {
      ...options,
      phase,
    })

    if (phase !== NovaPhase.Render) {
      return this.addDisposer(dispose)
    }

    const disposeFlush = this.raph.observeData(this.surface, path, {
      ...options,
      phase: NovaPhase.Flush,
    })

    return this.addDisposer(() => {
      dispose()
      disposeFlush()
    })
  }

  //
  // RAPH PROPERTIES - CORE
  //

  /**
   * Возвращает active.
   */
  @RaphProperty({
    phase: 'update',
    default: true,
    propagation: RaphPropagation.Down,
    compute: self => {
      const localActive = self.getLocal('localActive') ?? true
      const parentActive = self.parent?.get('active') ?? true
      return localActive && parentActive
    },
  })
  get active(): boolean {
    return this.get('active') ?? true
  }
  /**
   * Обновляет active.
   */
  set active(v: boolean) {
    if (this.localActive === v) return

    this.setLocal('localActive', v)
    this.nova.events.markSpatialDirty(this, true)
    this.raph.dirty('update', this)
  }

  /**
   * Возвращает visible.
   */
  @RaphProperty({
    phase: 'render',
    default: true,
    propagation: RaphPropagation.Down,
    compute: self => {
      const localVisible = self.getLocal('localVisible') ?? true
      const parentVisible = self.parent?.get('visible') ?? true
      return localVisible && parentVisible
    },
  })
  get visible(): boolean {
    return this.get('visible') ?? true
  }
  /**
   * Обновляет visible.
   */
  set visible(v: boolean) {
    if (this.localVisible === v) return

    this.setLocal('localVisible', v)
    this.nova.events.markSpatialDirty(this, true)
    this.dirty({ render: true })
  }

  /**
   * Возвращает opacity.
   */
  @RaphProperty({ phase: 'render', default: 1 })
  get opacity(): number {
    return this.get('opacity')
  }
  /**
   * Обновляет opacity.
   */
  set opacity(v: number) {
    this.set('opacity', v)
  }

  //
  // RAPH PROPERTIES - GEOMETRY
  //

  /**
   * Возвращает x.
   */
  @RaphProperty({ phase: 'matrix', default: 0 })
  get x(): number {
    return this.get('x')
  }
  /**
   * Обновляет x.
   */
  set x(v: number) {
    this.set('x', v)
  }

  /**
   * Возвращает y.
   */
  @RaphProperty({ phase: 'matrix', default: 0 })
  get y(): number {
    return this.get('y')
  }
  /**
   * Обновляет y.
   */
  set y(v: number) {
    this.set('y', v)
  }

  /**
   * Возвращает width.
   */
  @RaphProperty({ phase: 'render', default: 0 })
  get width(): number {
    return this.get('width')
  }
  /**
   * Обновляет width.
   */
  set width(v: number) {
    this.set('width', v)
  }

  /**
   * Возвращает height.
   */
  @RaphProperty({ phase: 'render', default: 0 })
  get height(): number {
    return this.get('height')
  }
  /**
   * Обновляет height.
   */
  set height(v: number) {
    this.set('height', v)
  }

  /**
   * Возвращает scale x.
   */
  @RaphProperty({ phase: 'matrix', default: 1 })
  get scaleX(): number {
    return this.get('scaleX')
  }
  /**
   * Обновляет scale x.
   */
  set scaleX(v: number) {
    this.set('scaleX', v)
  }

  /**
   * Возвращает scale y.
   */
  @RaphProperty({ phase: 'matrix', default: 1 })
  get scaleY(): number {
    return this.get('scaleY')
  }
  /**
   * Обновляет scale y.
   */
  set scaleY(v: number) {
    this.set('scaleY', v)
  }

  /**
   * Возвращает rotation.
   */
  @RaphProperty({ phase: 'matrix', default: 0 })
  get rotation(): number {
    return this.get('rotation')
  }
  /**
   * Обновляет rotation.
   */
  set rotation(v: number) {
    this.set('rotation', v)
  }

  /**
   * Возвращает matrix.
   */
  @RaphProperty({
    phase: 'matrix',
    default: mat3.create(),
    propagation: RaphPropagation.Down,
    dependsOn: ['x', 'y', 'scaleX', 'scaleY', 'rotation'],
    compute: self => {
      const x = self.x || 0
      const y = self.y || 0
      const rot = self.rotation || 0
      const sx = self.scaleX || 1
      const sy = self.scaleY || 1

      const out = mat3.create()
      mat3.identity(out)
      if (x !== 0 || y !== 0) mat3.translate(out, out, [x, y])
      if (rot !== 0) mat3.rotate(out, out, rot)
      if (sx !== 1 || sy !== 1) mat3.scale(out, out, [sx, sy])

      const parentMatrix = self.parent?.matrix
      if (parentMatrix) mat3.multiply(out, parentMatrix, out)

      return out
    },
  })
  get matrix(): mat3 {
    return this.get('matrix')
  }

  //
  // RAPH PROPERTIES - INTERACTIVE
  //

  /**
   * Возвращает interactive.
   */
  @RaphProperty({ phase: 'preupdate', default: false })
  get interactive(): boolean {
    return this.get('interactive')
  }
  /**
   * Обновляет interactive.
   */
  set interactive(v: boolean) {
    if (this.interactive === v) return
    this.nova.events.markSpatialDirty(this)
    this.set('interactive', v)
  }

  /**
   * Возвращает cursor declaration.
   */
  @RaphProperty({ phase: 'preupdate', default: null })
  get cursor(): NovaCursorDeclaration | null {
    return this.get('cursor')
  }
  /**
   * Обновляет cursor declaration.
   */
  set cursor(v: NovaCursorDeclaration | null) {
    if (this.cursor === v) return
    this.set('cursor', v)
    this.syncCursorRegistration()
  }

  /**
   * Возвращает cursor context.
   */
  @RaphProperty({ phase: 'preupdate', default: null })
  get cursorContext(): NovaCursorContext | null {
    return this.get('cursorContext')
  }
  /**
   * Обновляет cursor context.
   */
  set cursorContext(v: NovaCursorContext | null) {
    if (this.cursorContext === v) return
    this.set('cursorContext', v)
    this.nova.cursors.markSpatialDirty(this)
  }

  /**
   * Возвращает propagate update.
   */
  @RaphProperty({ phase: 'preupdate', default: false })
  get propagateUpdate(): boolean {
    return this.get('propagateUpdate')
  }
  /**
   * Обновляет propagate update.
   */
  set propagateUpdate(v: boolean) {
    this.set('propagateUpdate', v)
  }

  //
  // RAPH HANDLERS
  //

  /**
   * Выполняет внутреннюю операцию do update.
   */
  @RaphAfter({ phase: 'update' })
  doUpdate(): void {
    if (!this.active) return

    this.debugger.startTimer('update')
    this.update()
    this.debugger.info(`${this.__type} завершил update`, 'update')
  }

  /**
   * Выполняет внутреннюю операцию do matrix.
   */
  @RaphAfter({ phase: 'matrix' })
  doMatrix(): void {
    this.debugger.info(`${this.__type} завершил matrix`, 'matrix')
  }

  /**
   * Выполняет внутреннюю операцию do render.
   */
  @RaphAfter({ phase: 'render' })
  doRender(): void {
    if (!this.visible) return

    if (this._surface && this.surface.renderCullingMode === 'bounds') {
      this.surface.markRenderNodeTestedForCulling()
      if (!boundsIntersects(this.getRenderBounds(), this.surface.getWorldBounds())) {
        this.surface.markRenderNodeCulled()
        return
      }
    }

    this.debugger.startTimer('render')

    const matrix = this.get('matrix')!

    const nodeAwareRenderer = this.resolveNodeAwareRenderer()
    nodeAwareRenderer?.beginNode(this)
    try {
      this.renderer.save()
      this.renderer.setTransform(matrix)
      this.render()
      this.renderChildren()
      this.renderer.restore()
    } finally {
      nodeAwareRenderer?.endNode(this)
    }
    this.surface.markRenderNodeRebuilt()
    this._renderFrameDirty = false

    this.debugger.info(`${this.__type} завершил render`, 'render')
  }

  //
  // BEHAVIOR
  //

  /**
   * Выполняет внутреннюю операцию options.
   */
  override options(
    opts: Partial<NovaNodeProperties> & { zIndex?: number },
  ): this {
    const { zIndex, ...rest } = opts
    const spatialDirty = hasSpatialOptions(opts)
    const hasCursorOption = Object.prototype.hasOwnProperty.call(opts, 'cursor')
    const hasCursorContextOption = Object.prototype.hasOwnProperty.call(opts, 'cursorContext')

    if (zIndex !== undefined) {
      super.options({
        ...rest,
        weight: zIndex,
      })
      if (hasCursorOption) this.syncCursorRegistration()
      if (hasCursorContextOption) this.nova.cursors.markSpatialDirty(this)
      if (spatialDirty) this.markSpatialDirtyForOptions(opts)
      return this
    }

    super.options(opts)
    if (hasCursorOption) this.syncCursorRegistration()
    if (hasCursorContextOption) this.nova.cursors.markSpatialDirty(this)
    if (spatialDirty) this.markSpatialDirtyForOptions(opts)
    return this
  }

  /**
   * Выполняет внутреннюю операцию dirty.
   */
  dirty(
    opts:
      | { matrix?: boolean; update?: boolean; render?: boolean }
      | string
      | Array<string>,
  ): void {
    if (typeof opts === 'string') {
      this.raph.dirty(opts, this)
      return
    }

    if (Array.isArray(opts)) {
      opts.forEach(opt => this.raph.dirty(opt, this))
      return
    }

    const { matrix, update, render } = opts
    if (update) this.raph.dirty('update', this)
    if (matrix) {
      this.markRenderDirtyFlags({ transform: true, layout: true, visibility: true })
      this.surface.renderGraph?.markTransformDirty(this.renderNodeId)
      this.surface.renderGraph?.markVisibilityDirty(this.renderNodeId)
      if (!this.surface.renderGraph) this.markRenderFrameDirty(true)
      this.nova.events.markSpatialDirty(this, true)
      this.raph.dirty('matrix', this)
      this.raph.dirty('render', this.surface)
      this.raph.dirty('flush', this.surface)
    }
    if (render) {
      this.markRenderDirtyFlags({ paint: true, resource: true, cache: true })
      this.surface.renderGraph?.markPaintDirty(this.renderNodeId)
      this.surface.renderGraph?.markResourceDirty(this.renderNodeId)
      this.markRenderFrameDirty(true)
      this.nova.events.markSpatialDirty(this)
      this.raph.dirty('render', this.surface) // отрисовка всегда от корня слоя
      this.raph.dirty('flush', this.surface)
    }
  }

  /**
   * Возвращает local bounds.
   */
  getLocalBounds(): NovaBounds {
    return {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    }
  }

  /**
   * Возвращает world bounds.
   */
  getWorldBounds(): NovaBounds {
    return transformBounds(this.getLocalBounds(), this.matrix)
  }

  /**
   * Возвращает render bounds.
   */
  getRenderBounds(): NovaBounds {
    return transformBounds(this.getLocalRenderBounds(), this.matrix)
  }

  /**
   * Возвращает local render bounds.
   */
  getLocalRenderBounds(): NovaBounds {
    if (this._hasLocalRenderBounds) return { ...this._localRenderBounds }
    return this.getLocalBounds()
  }

  /**
   * Обновляет local render bounds.
   */
  setLocalRenderBounds(bounds: NovaBounds): this {
    if (this._hasLocalRenderBounds && boundsEquals(this._localRenderBounds, bounds)) return this

    copyBounds(this._localRenderBounds, bounds)
    this._hasLocalRenderBounds = true
    this.nova.events.markSpatialDirty(this)
    this.nova.cursors.markSpatialDirty(this)
    return this
  }

  /**
   * Обновляет render bounds from schema.
   */
  setRenderBoundsFromSchema(schema: NovaSchema<any>): this {
    return this.setLocalRenderBounds(resolveSchemaBounds(schema, this.nova.schema))
  }

  /**
   * Очищает local render bounds.
   */
  clearLocalRenderBounds(): this {
    if (!this._hasLocalRenderBounds) return this

    this._hasLocalRenderBounds = false
    copyBounds(this._localRenderBounds, createEmptyBounds())
    this.nova.events.markSpatialDirty(this)
    this.nova.cursors.markSpatialDirty(this)
    return this
  }

  /**
   * Выполняет внутреннюю операцию contains point.
   */
  containsPoint(x: number, y: number): boolean {
    const inverse = this.getInverseMatrix()
    if (!inverse) return false

    const localX = inverse[0] * x + inverse[3] * y + inverse[6]
    const localY = inverse[1] * x + inverse[4] * y + inverse[7]

    const bounds = this.getLocalRenderBounds()

    return (
      localX >= bounds.x &&
      localY >= bounds.y &&
      localX <= bounds.x + bounds.width &&
      localY <= bounds.y + bounds.height
    )
  }

  /**
   * Выполняет внутреннюю операцию to local.
   */
  toLocal(gx: number, gy: number): [number, number] {
    const inverse = this.getInverseMatrix()
    if (!inverse) return [gx, gy]
    return [
      inverse[0] * gx + inverse[3] * gy + inverse[6],
      inverse[1] * gx + inverse[4] * gy + inverse[7],
    ]
  }

  //
  // EVENTS
  //

  /**
   * Выполняет внутреннюю операцию on.
   */
  on<K extends keyof NovaNodeEventHandlers>(
    type: OneOrMany<K>,
    handler: NonNullable<NovaNodeEventHandlers[K]>,
  ): void {
    if (Array.isArray(type)) {
      type.forEach(t => this.on(t, handler))
      return
    }
    this.installEventHandler(type, handler)
    this.nova.registerInteractiveNode(this)
  }

  /**
   * Привязывает sound cues к событиям node без замены пользовательских handlers.
   */
  withSound(map: NovaNodeSoundMap): this {
    if (!this._soundEventBindings) {
      this._soundEventBindings = new Map()
    }

    for (const [eventName, cue] of Object.entries(map) as Array<[keyof NovaNodeEventHandlers, NovaSoundCueInput | undefined]>) {
      if (!cue) continue
      this._soundEventBindings.set(eventName, cue)
      const handler = this._soundUserHandlers.has(eventName)
        ? this._soundUserHandlers.get(eventName)
        : this.eventHandlers[eventName]
      this.installEventHandler(eventName, handler as any)
      this.nova.registerInteractiveNode(this)
    }

    return this
  }

  /**
   * Обрабатывает событие capture.
   */
  onCapture<K extends keyof NovaNodeEventHandlers>(
    type: OneOrMany<K>,
    handler: NonNullable<NovaNodeEventHandlers[K]>,
  ): void {
    if (Array.isArray(type)) {
      type.forEach(t => this.onCapture(t, handler))
      return
    }
    this.captureEventHandlers[type] = handler
    this.nova.registerInteractiveNode(this)
  }

  /**
   * Выполняет внутреннюю операцию off.
   */
  off<K extends keyof NovaNodeEventHandlers>(type: K): void {
    delete this.eventHandlers[type]
    this._soundUserHandlers.delete(type)
    this._soundEventBindings?.delete(type)
    if (Object.keys(this.eventHandlers).length === 0 && Object.keys(this.captureEventHandlers).length === 0) {
      this.nova.unregisterInteractiveNode(this)
    }
  }

  /**
   * Выполняет внутреннюю операцию off capture.
   */
  offCapture<K extends keyof NovaNodeEventHandlers>(type: K): void {
    delete this.captureEventHandlers[type]
    if (Object.keys(this.eventHandlers).length === 0 && Object.keys(this.captureEventHandlers).length === 0) {
      this.nova.unregisterInteractiveNode(this)
    }
  }

  /**
   * Выполняет внутреннюю операцию off all.
   */
  offAll(): void {
    for (const key in this.eventHandlers) {
      delete this.eventHandlers[key as keyof NovaNodeEventHandlers]
    }
    for (const key in this.captureEventHandlers) {
      delete this.captureEventHandlers[key as keyof NovaNodeEventHandlers]
    }
    this._soundUserHandlers.clear()
    this._soundEventBindings?.clear()
    this.nova.unregisterInteractiveNode(this)
  }

  /**
   * Устанавливает event handler с optional sound wrapper.
   */
  private installEventHandler<K extends keyof NovaNodeEventHandlers>(
    type: K,
    handler: NonNullable<NovaNodeEventHandlers[K]> | undefined,
  ): void {
    const cue = this._soundEventBindings?.get(type)
    if (!cue) {
      if (handler) this.eventHandlers[type] = handler
      this._soundUserHandlers.delete(type)
      return
    }

    this._soundUserHandlers.set(type, handler)
    this.eventHandlers[type] = ((event: Event, ...args: Array<unknown>) => {
      const handle = this.nova.sound.playCue(cue)
      if (handle) this.trackSoundHandle(handle)
      const userHandler = this._soundUserHandlers.get(type)
      if (typeof userHandler === 'function') {
        return (userHandler as (...handlerArgs: Array<unknown>) => unknown)(event, ...args)
      }
      return undefined
    }) as NonNullable<NovaNodeEventHandlers[K]>
  }

  /**
   * Отслеживает node-scoped sound handle.
   */
  private trackSoundHandle(handle: NovaSoundHandle): void {
    this._soundHandles.add(handle)
    void handle.ended.finally(() => this._soundHandles.delete(handle))
  }

  /**
   * Останавливает node-scoped sounds.
   */
  private stopSoundHandles(): void {
    for (const handle of [...this._soundHandles]) {
      handle.stop()
    }
    this._soundHandles.clear()
  }

  /**
   * Выполняет внутреннюю операцию capture pointer.
   */
  capturePointer(event?: MouseEvent): void {
    this.nova.events.setPointerCapture(this, event)
  }

  /**
   * Выполняет внутреннюю операцию release pointer capture.
   */
  releasePointerCapture(event?: MouseEvent): void {
    this.nova.events.releasePointerCapture(this, event)
  }

  /**
   * Проверяет наличие pointer capture.
   */
  hasPointerCapture(event?: MouseEvent): boolean {
    return this.nova.events.hasPointerCapture(this, event)
  }

  /**
   * Выполняет внутреннюю операцию focus.
   */
  focus(event?: Event, scope?: string): void {
    this.nova.events.focus(this, event, scope)
  }

  /**
   * Выполняет внутреннюю операцию blur.
   */
  blur(event?: Event, scope?: string): void {
    this.nova.events.blur(this, event, scope)
  }

  /**
   * Выполняет внутреннюю операцию select.
   */
  select(options?: { append?: boolean; toggle?: boolean; scope?: string }, event?: Event): void {
    this.nova.events.select(this, options, event)
  }

  /**
   * Выполняет внутреннюю операцию deselect.
   */
  deselect(event?: Event, scope?: string): void {
    this.nova.events.deselect(this, event, scope)
  }

  /**
   * Возвращает focused.
   */
  get focused(): boolean {
    return this.nova.events.focusedNode === this
  }

  /**
   * Выполняет внутреннюю операцию focused in.
   */
  focusedIn(scope: string): boolean {
    return this.nova.events.isFocused(this, scope)
  }

  /**
   * Возвращает selected.
   */
  get selected(): boolean {
    return this.nova.events.isSelected(this)
  }

  /**
   * Выполняет внутреннюю операцию selected in.
   */
  selectedIn(scope: string): boolean {
    return this.nova.events.isSelected(this, scope)
  }

  //
  // STATE
  //

  /**
   * Возвращает raph.
   */
  get raph(): RaphApp<NovaNodeProperties> {
    return super.raph
  }

  /**
   * Возвращает nova.
   */
  get nova(): NovaApp<E> {
    return this._nova
  }

  /**
   * Возвращает canvas.
   */
  get canvas(): NovaCanvas {
    return this.surface.canvas
  }

  /**
   * Возвращает surface.
   */
  get surface(): NovaSurface<E> {
    return this._surface! ?? (this as any as NovaSurface<E>)
  }

  /**
   * Возвращает renderer.
   */
  get renderer(): NovaRenderer {
    return this.surface.renderer
  }

  /**
   * Возвращает events.
   */
  get events(): NovaEvents<E> {
    return this.nova.events
  }

  /**
   * Возвращает debugger.
   */
  get debugger(): NovaDebug {
    return this.nova.debugger
  }

  /**
   * Возвращает local active.
   */
  get localActive(): boolean {
    return this.getLocal('localActive') ?? true
  }

  /**
   * Возвращает local visible.
   */
  get localVisible(): boolean {
    return this.getLocal('localVisible') ?? true
  }

  /**
   * Возвращает render subtree dirty.
   */
  get renderFrameDirty(): boolean {
    return this._renderFrameDirty
  }

  /**
   * Возвращает render policy.
   */
  get renderPolicy(): NovaRenderPolicy {
    return this._renderPolicy
  }

  /**
   * Обновляет render policy.
   */
  set renderPolicy(value: NovaRenderPolicyInput) {
    this._renderPolicy = resolveNovaRenderPolicy(value)
    this.markRenderDirtyFlags({ cache: true })
    this.markRenderFrameDirty(true)
  }

  /**
   * Возвращает render dirty flags.
   */
  get renderDirtyFlags(): NovaRenderDirtyFlags {
    return { ...this._renderDirtyFlags }
  }

  /**
   * Возвращает render versions.
   */
  get renderVersions(): NovaRenderVersions {
    return { ...this._renderVersions }
  }

  /**
   * Возвращает render node id.
   */
  get renderNodeId(): string {
    return String((this as { id?: string | number }).id ?? this.__type)
  }

  /**
   * Возвращает transform version.
   */
  get transformVersion(): number {
    return this._renderVersions.transform
  }

  /**
   * Возвращает layout version.
   */
  get layoutVersion(): number {
    return this._renderVersions.layout
  }

  /**
   * Возвращает paint version.
   */
  get paintVersion(): number {
    return this._renderVersions.paint
  }

  /**
   * Возвращает children version.
   */
  get childrenVersion(): number {
    return this._renderVersions.children
  }

  /**
   * Возвращает resource version.
   */
  get resourceVersion(): number {
    return this._renderVersions.resource
  }

  /**
   * Выполняет внутреннюю операцию configure render policy.
   */
  configureRenderPolicy(value: NovaRenderPolicyInput): this {
    this.renderPolicy = value
    return this
  }

  /**
   * Помечает render dirty flags.
   */
  markRenderDirtyFlags(flags: Partial<NovaRenderDirtyFlags>): void {
    mergeRenderDirtyFlags(this._renderDirtyFlags, flags)
    bumpRenderVersions(this._renderVersions, flags)
  }

  /**
   * Очищает render dirty flags.
   */
  clearRenderDirtyFlags(): void {
    const clean = createCleanRenderDirtyFlags()
    Object.assign(this._renderDirtyFlags, clean)
  }

  /**
   * Возвращает lifecycle state.
   */
  get lifecycleState(): NovaLifecycleState {
    return this._lifecycleState
  }

  /**
   * Помечает render subtree dirty.
   */
  markRenderFrameDirty(includeChildren = false): void {
    this._renderFrameDirty = true

    let parent = this.parent
    while (parent instanceof NovaNode) {
      parent._renderFrameDirty = true
      parent = parent.parent
    }

    if (!includeChildren) return

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.markRenderFrameDirty(true)
      }
    }
  }

  /**
   * Помечает render subtree clean.
   */
  markRenderFrameClean(includeChildren = false): void {
    this._renderFrameDirty = false
    this.clearRenderDirtyFlags()

    if (!includeChildren) return

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.markRenderFrameClean(true)
      }
    }
  }

  /**
   * Обновляет scale.
   */
  setScale(x: number, y: number): void {
    if (this.scaleX === x && this.scaleY === y) return

    this.scaleX = x
    this.scaleY = y
  }

  /**
   * Обновляет rotation.
   */
  setRotation(angle: number): void {
    if (this.rotation === angle) return

    this.rotation = angle
  }

  /**
   * Возвращает inverse matrix.
   */
  private getInverseMatrix(): mat3 | undefined {
    const matrix = this.matrix
    if (this._inverseMatrixSource === matrix) return this._inverseMatrix

    const inverse = mat3.invert(this._inverseMatrix, matrix)
    if (!inverse) return undefined

    this._inverseMatrixSource = matrix
    return this._inverseMatrix
  }

  /**
   * Обновляет position.
   */
  setPosition(x: number, y: number): void {
    if (this.x === x && this.y === y) return

    this.x = x
    this.y = y
  }

  /**
   * Обновляет size.
   */
  setSize(width: number, height: number): void {
    if (this.width === width && this.height === height) return

    this.width = width
    this.height = height
  }

  /**
   * Выполняет поиск scoped dependency по ancestor chain.
   */
  private resolveInjectedValue<T>(token: NovaContextToken<T>): NovaContextLookup<T> {
    const cached = this._injectCache?.get(token) as NovaInjectCacheEntry<T> | undefined
    if (
      cached
      && cached.scopeVersion === this.nova.contextVersion
      && cached.provider._providerVersion === cached.providerVersion
    ) {
      return {
        found: true,
        value: cached.value,
      }
    }

    let parent = this.parent
    while (parent) {
      if (parent instanceof NovaNode && parent._provides?.has(token)) {
        const value = parent._provides.get(token) as T
        this.cacheInjectedValue(token, {
          provider: parent,
          providerVersion: parent._providerVersion,
          scopeVersion: this.nova.contextVersion,
          value,
        })
        return {
          found: true,
          value,
        }
      }

      parent = parent.parent
    }

    this._injectCache?.delete(token)
    return { found: false }
  }

  /**
   * Сохраняет найденный scoped dependency в локальном inject-cache.
   */
  private cacheInjectedValue<T>(token: NovaContextToken<T>, entry: NovaInjectCacheEntry<T>): void {
    if (!this._injectCache) {
      this._injectCache = new Map()
    }

    this._injectCache.set(token, entry)
  }

  /**
   * Сбрасывает inject-cache у этой ноды и ее потомков.
   */
  private clearInjectCacheDeep(): void {
    const stack: Array<NovaNode<any>> = [this]
    while (stack.length > 0) {
      const node = stack.pop()!
      node._injectCache?.clear()
      for (const child of node.children) {
        if (child instanceof NovaNode) {
          stack.push(child)
        }
      }
    }
  }

  /**
   * Выполняет dispose callbacks текущей ноды.
   */
  private runDisposers(): void {
    const disposers = this._disposers.splice(0)
    for (const dispose of disposers) {
      dispose()
    }
  }

  /**
   * Выполняет внутреннюю операцию dispose.
   */
  override dispose(): void {
    if (this._lifecycleState === 'destroyed') return

    this.nova.motion.cancel(this)
    this.stopSoundHandles()
    this.unmountSubtree()
    this.runDisposers()
    super.dispose()
    this.offAll()
    this._orderedChildren.length = 0
    this._provides?.clear()
    this._injectCache?.clear()
    this._nodeContext = undefined
    this._hasNodeContext = false
    this._inverseMatrixSource = undefined
    this._renderFrameDirty = true
    this._lifecycleState = 'destroyed'
    this.nova.events.markSpatialDirty(this, true)
    this.nova.cursors.unregister(this)
  }

  /**
   * Выполняет render-операцию schema.
   */
  protected renderSchema(schema: NovaSchema<any>): void {
    this.setRenderBoundsFromSchema(schema)
    this.renderer.schema(schema)
  }

  /**
   * Выполняет render-операцию schema ordered.
   */
  protected renderSchemaOrdered(schema: NovaSchema<any>): void {
    this.setRenderBoundsFromSchema(schema)
    this.renderer.schema(schema)
  }

  /**
   * Помечает spatial dirty for options.
   */
  private markSpatialDirtyForOptions(opts: Partial<NovaNodeProperties> & { zIndex?: number }): void {
    const includeChildren = (
      opts.x !== undefined
      || opts.y !== undefined
      || opts.scaleX !== undefined
      || opts.scaleY !== undefined
      || opts.rotation !== undefined
      || opts.active !== undefined
      || opts.visible !== undefined
    )
    this.nova.events.markSpatialDirty(this, includeChildren)
    this.nova.cursors.markSpatialDirty(this, includeChildren)
  }

  /**
   * Синхронизирует регистрацию node в cursor index.
   */
  private syncCursorRegistration(): void {
    if (this.cursor) {
      this.nova.cursors.register(this)
      return
    }

    this.nova.cursors.unregister(this)
  }

  /**
   * Выполняет внутреннюю операцию remove.
   */
  override remove(): void {
    const parent = this.parent
    if (parent) {
      const index = parent.children.indexOf(this)
      if (index >= 0) parent.children.splice(index, 1)
    }

    this.dispose()

    if (parent instanceof NovaNode) {
      parent.dirty({ render: true })
    }
  }

  /**
   * Выполняет render-операцию children.
   */
  protected renderChildren(): void {
    this._orderedChildren.length = 0

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        this._orderedChildren.push(child)
      }
    }

    this._orderedChildren.sort((a, b) => {
      const weightDiff = a.weight - b.weight
      if (weightDiff !== 0) return weightDiff
      return this.renderOrderOf(a) - this.renderOrderOf(b)
    })

    for (const child of this._orderedChildren) {
      child.doRender()
    }
  }

  /**
   * Вычисляет node aware renderer.
   */
  private resolveNodeAwareRenderer(): NovaRenderNodeAwareRenderer | null {
    const renderer = this.renderer as Partial<NovaRenderNodeAwareRenderer>
    return typeof renderer.beginNode === 'function' && typeof renderer.endNode === 'function'
      ? renderer as NovaRenderNodeAwareRenderer
      : null
  }

  /**
   * Добавляет child.
   */
  override addChild(node: RaphNode<any>, options: NovaAddChildOptions = {}): boolean {
    const { context, ...raphOptions } = options
    const hasExplicitContext = Object.prototype.hasOwnProperty.call(options, 'context')

    if (node instanceof NovaNode) {
      if (node.lifecycleState === 'destroyed') {
        throw new Error('Нельзя повторно добавить уничтоженную Nova-ноду')
      }
      if (hasExplicitContext) {
        node.setContext(context)
      }
      node.clearInjectCacheDeep()
      this.ensureRenderOrder(node)
    }
    const result = super.addChild(node, raphOptions)
    this.markRenderDirtyFlags({ children: true, cache: true })
    this.markRenderFrameDirty(false)
    if (node instanceof NovaNode) {
      if (this._lifecycleState === 'mounted' || this._lifecycleState === 'paused') {
        node.mountSubtree()
      }
      if (this._lifecycleState === 'paused') {
        node.pause()
      }
      node.markRenderFrameDirty(true)
    }

    return result
  }

  /**
   * Выполняет внутреннюю операцию ensure render order.
   */
  private ensureRenderOrder(node: NovaNode<E>): void {
    if (this._renderOrder.has(node)) return
    this._renderOrder.set(node, this._renderOrderCounter++)
  }

  /**
   * Выполняет render-операцию order of.
   */
  private renderOrderOf(node: NovaNode<E>): number {
    this.ensureRenderOrder(node)
    return this._renderOrder.get(node)!
  }

  /**
   * Выполняет render-операцию order index of.
   */
  renderOrderIndexOf(node: NovaNode<E>): number {
    return this.renderOrderOf(node)
  }

  /**
   * Выполняет внутреннюю операцию mount subtree.
   */
  mountSubtree(): void {
    if (this._lifecycleState === 'destroyed') {
      throw new Error('Нельзя смонтировать уничтоженную Nova-ноду')
    }
    if (this._lifecycleState === 'mounted' || this._lifecycleState === 'paused') return

    this._lifecycleState = 'mounted'
    this.onMount()

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.mountSubtree()
      }
    }
  }

  /**
   * Выполняет внутреннюю операцию pause.
   */
  pause(): this {
    if (this._lifecycleState !== 'mounted') return this

    this._lifecycleState = 'paused'
    this.onPause()

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.pause()
      }
    }

    return this
  }

  /**
   * Выполняет внутреннюю операцию resume.
   */
  resume(): this {
    if (this._lifecycleState !== 'paused') return this

    this._lifecycleState = 'mounted'
    this.onResume()

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.resume()
      }
    }

    this.dirty({ update: true, matrix: true, render: true })
    return this
  }

  /**
   * Выполняет внутреннюю операцию unmount subtree.
   */
  private unmountSubtree(): void {
    if (this._lifecycleState === 'created' || this._lifecycleState === 'destroyed') return

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.unmountSubtree()
      }
    }

    this.onUnmount()
    this._lifecycleState = 'created'
  }

  /**
   * Обрабатывает событие mount.
   */
  protected onMount(): void {}
  /**
   * Обрабатывает событие unmount.
   */
  protected onUnmount(): void {}
  /**
   * Обрабатывает событие pause.
   */
  protected onPause(): void {}
  /**
   * Обрабатывает событие resume.
   */
  protected onResume(): void {}

  //
  // CHILD LOGIC
  //

  /**
   * Выполняет render-операцию .
   */
  render(): void {}
  /**
   * Выполняет внутреннюю операцию update.
   */
  update(): void {}
}

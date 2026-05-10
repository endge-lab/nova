import { mat3 } from 'gl-matrix'
import { RaphNode } from '@endge/raph'
import { RaphPropagation } from '@endge/raph'
import type { NovaNodeProperties } from '@/domain/types/base-types'
import type { NovaNodeEventHandlers } from '@/domain/types/events-types'
import type { NovaApp } from '@/model/app/NovaApp'
import type { NovaSurface } from '@/model/core/NovaSurface'
import { RaphAfter, RaphProperty } from '@endge/raph'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import type { NovaBounds, NovaLifecycleState, NovaRenderer, NovaSchema } from '@/domain/types/renderer-types'
import type { RaphApp } from '@endge/raph'
import type { NovaEvents } from '@/model/core/NovaEvents'
import type { NovaDebug } from '@/model/app/NovaDebug'
import type { OneOrMany } from '@endge/utils'
import type { EventList } from '@endge/utils'
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
} from '@/model/rendering/policy/NovaRenderPolicy'

interface NovaRenderNodeAwareRenderer {
  beginNode(node: NovaNode<any>): void
  endNode(node: NovaNode<any>): void
}

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
    || opts.zIndex !== undefined
  )
}

export class NovaNode<
  E extends EventList,
> extends RaphNode<NovaNodeProperties> {
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
  private _renderSubtreeDirty = true
  private _lifecycleState: NovaLifecycleState = 'created'
  private _hasLocalRenderBounds = false
  private _renderPolicy: NovaRenderPolicy = resolveNovaRenderPolicy()
  private readonly _renderDirtyFlags: NovaRenderDirtyFlags = createCleanRenderDirtyFlags()
  private readonly _renderVersions: NovaRenderVersions = createRenderVersions()

  //
  // CTOR
  //

  constructor(app: NovaApp<E>, surface?: NovaSurface<E>) {
    super(app.raph)
    this._nova = app
    this._surface = surface
    this.__type = this.constructor.name
  }

  //
  // RAPH PROPERTIES - CORE
  //

  @RaphProperty({
    phase: 'update',
    default: true,
    propagation: RaphPropagation.Down,
    compute: (self) => {
      const localActive = self.getLocal('localActive') ?? true
      const parentActive = self.parent?.get('active') ?? true
      return localActive && parentActive
    },
  })
  get active(): boolean {
    return this.get('active') ?? true
  }
  set active(v: boolean) {
    if (this.localActive === v) return

    this.setLocal('localActive', v)
    this.nova.events.markSpatialDirty(this, true)
    this.raph.dirty('update', this)
  }

  @RaphProperty({
    phase: 'render',
    default: true,
    propagation: RaphPropagation.Down,
    compute: (self) => {
      const localVisible = self.getLocal('localVisible') ?? true
      const parentVisible = self.parent?.get('visible') ?? true
      return localVisible && parentVisible
    },
  })
  get visible(): boolean {
    return this.get('visible') ?? true
  }
  set visible(v: boolean) {
    if (this.localVisible === v) return

    this.setLocal('localVisible', v)
    this.nova.events.markSpatialDirty(this, true)
    this.dirty({ render: true })
  }

  @RaphProperty({ phase: 'render', default: 1 })
  get opacity(): number {
    return this.get('opacity')
  }
  set opacity(v: number) {
    this.set('opacity', v)
  }

  //
  // RAPH PROPERTIES - GEOMETRY
  //

  @RaphProperty({ phase: 'matrix', default: 0 })
  get x(): number {
    return this.get('x')
  }
  set x(v: number) {
    this.set('x', v)
  }

  @RaphProperty({ phase: 'matrix', default: 0 })
  get y(): number {
    return this.get('y')
  }
  set y(v: number) {
    this.set('y', v)
  }

  @RaphProperty({ phase: 'render', default: 0 })
  get width(): number {
    return this.get('width')
  }
  set width(v: number) {
    this.set('width', v)
  }

  @RaphProperty({ phase: 'render', default: 0 })
  get height(): number {
    return this.get('height')
  }
  set height(v: number) {
    this.set('height', v)
  }

  @RaphProperty({ phase: 'matrix', default: 1 })
  get scaleX(): number {
    return this.get('scaleX')
  }
  set scaleX(v: number) {
    this.set('scaleX', v)
  }

  @RaphProperty({ phase: 'matrix', default: 1 })
  get scaleY(): number {
    return this.get('scaleY')
  }
  set scaleY(v: number) {
    this.set('scaleY', v)
  }

  @RaphProperty({ phase: 'matrix', default: 0 })
  get rotation(): number {
    return this.get('rotation')
  }
  set rotation(v: number) {
    this.set('rotation', v)
  }

  @RaphProperty({
    phase: 'matrix',
    default: mat3.create(),
    propagation: RaphPropagation.Down,
    dependsOn: ['x', 'y', 'scaleX', 'scaleY', 'rotation'],
    compute: (self) => {
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

  @RaphProperty({ phase: 'preupdate', default: false })
  get interactive(): boolean {
    return this.get('interactive')
  }
  set interactive(v: boolean) {
    if (this.interactive === v) return
    this.nova.events.markSpatialDirty(this)
    this.set('interactive', v)
  }

  @RaphProperty({ phase: 'preupdate', default: false })
  get propagateUpdate(): boolean {
    return this.get('propagateUpdate')
  }
  set propagateUpdate(v: boolean) {
    this.set('propagateUpdate', v)
  }

  //
  // RAPH HANDLERS
  //

  @RaphAfter({ phase: 'update' })
  doUpdate(): void {
    if (!this.active) return

    this.debugger.startTimer('update')
    this.update()
    this.debugger.info(`${this.__type} завершил update`, 'update')
  }

  @RaphAfter({ phase: 'matrix' })
  doMatrix(): void {
    this.debugger.info(`${this.__type} завершил matrix`, 'matrix')
  }

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
    this._renderSubtreeDirty = false

    this.debugger.info(`${this.__type} завершил render`, 'render')
  }

  //
  // BEHAVIOR
  //

  override options(
    opts: Partial<NovaNodeProperties> & { zIndex?: number },
  ): this {
    const { zIndex, ...rest } = opts
    const spatialDirty = hasSpatialOptions(opts)

    if (zIndex !== undefined) {
      super.options({
        ...rest,
        weight: zIndex,
      })
      if (spatialDirty) this.markSpatialDirtyForOptions(opts)
      return this
    }

    super.options(opts)
    if (spatialDirty) this.markSpatialDirtyForOptions(opts)
    return this
  }

  dirty(
    opts:
      | { matrix?: boolean; update?: boolean; render?: boolean }
      | string
      | string[],
  ): void {
    if (typeof opts === 'string') {
      this.raph.dirty(opts, this)
      return
    }

    if (Array.isArray(opts)) {
      opts.forEach((opt) => this.raph.dirty(opt, this))
      return
    }

    const { matrix, update, render } = opts
    if (update) this.raph.dirty('update', this)
    if (matrix) {
      this.markRenderDirtyFlags({ transform: true, layout: true, visibility: true })
      this.surface.renderGraph?.markTransformDirty(this.renderNodeId)
      this.surface.renderGraph?.markVisibilityDirty(this.renderNodeId)
      if (!this.surface.renderGraph) this.markRenderSubtreeDirty(true)
      this.nova.events.markSpatialDirty(this, true)
      this.raph.dirty('matrix', this)
      this.raph.dirty('render', this.surface)
      this.raph.dirty('flush', this.surface)
    }
    if (render) {
      this.markRenderDirtyFlags({ paint: true, resource: true, cache: true })
      this.surface.renderGraph?.markPaintDirty(this.renderNodeId)
      this.surface.renderGraph?.markResourceDirty(this.renderNodeId)
      this.markRenderSubtreeDirty(true)
      this.nova.events.markSpatialDirty(this)
      this.raph.dirty('render', this.surface) // отрисовка всегда от корня слоя
      this.raph.dirty('flush', this.surface)
    }
  }

  getLocalBounds(): NovaBounds {
    return {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    }
  }

  getWorldBounds(): NovaBounds {
    return transformBounds(this.getLocalBounds(), this.matrix)
  }

  getRenderBounds(): NovaBounds {
    return transformBounds(this.getLocalRenderBounds(), this.matrix)
  }

  getLocalRenderBounds(): NovaBounds {
    if (this._hasLocalRenderBounds) return { ...this._localRenderBounds }
    return this.getLocalBounds()
  }

  setLocalRenderBounds(bounds: NovaBounds): this {
    if (this._hasLocalRenderBounds && boundsEquals(this._localRenderBounds, bounds)) return this

    copyBounds(this._localRenderBounds, bounds)
    this._hasLocalRenderBounds = true
    this.nova.events.markSpatialDirty(this)
    return this
  }

  setRenderBoundsFromSchema(schema: NovaSchema<any>): this {
    return this.setLocalRenderBounds(resolveSchemaBounds(schema, this.nova.schema))
  }

  clearLocalRenderBounds(): this {
    if (!this._hasLocalRenderBounds) return this

    this._hasLocalRenderBounds = false
    copyBounds(this._localRenderBounds, createEmptyBounds())
    this.nova.events.markSpatialDirty(this)
    return this
  }

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

  on<K extends keyof NovaNodeEventHandlers>(
    type: OneOrMany<K>,
    handler: NonNullable<NovaNodeEventHandlers[K]>,
  ): void {
    if (Array.isArray(type)) {
      type.forEach((t) => this.on(t, handler))
      return
    }
    this.eventHandlers[type] = handler
    this.nova.registerInteractiveNode(this)
  }

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

  off<K extends keyof NovaNodeEventHandlers>(type: K): void {
    delete this.eventHandlers[type]
    if (Object.keys(this.eventHandlers).length === 0 && Object.keys(this.captureEventHandlers).length === 0) {
      this.nova.unregisterInteractiveNode(this)
    }
  }

  offCapture<K extends keyof NovaNodeEventHandlers>(type: K): void {
    delete this.captureEventHandlers[type]
    if (Object.keys(this.eventHandlers).length === 0 && Object.keys(this.captureEventHandlers).length === 0) {
      this.nova.unregisterInteractiveNode(this)
    }
  }

  offAll(): void {
    for (const key in this.eventHandlers) {
      delete this.eventHandlers[key as keyof NovaNodeEventHandlers]
    }
    for (const key in this.captureEventHandlers) {
      delete this.captureEventHandlers[key as keyof NovaNodeEventHandlers]
    }
    this.nova.unregisterInteractiveNode(this)
  }

  capturePointer(event?: MouseEvent): void {
    this.nova.events.setPointerCapture(this, event)
  }

  releasePointerCapture(event?: MouseEvent): void {
    this.nova.events.releasePointerCapture(this, event)
  }

  hasPointerCapture(event?: MouseEvent): boolean {
    return this.nova.events.hasPointerCapture(this, event)
  }

  focus(event?: Event, scope?: string): void {
    this.nova.events.focus(this, event, scope)
  }

  blur(event?: Event, scope?: string): void {
    this.nova.events.blur(this, event, scope)
  }

  select(options?: { append?: boolean; toggle?: boolean; scope?: string }, event?: Event): void {
    this.nova.events.select(this, options, event)
  }

  deselect(event?: Event, scope?: string): void {
    this.nova.events.deselect(this, event, scope)
  }

  get focused(): boolean {
    return this.nova.events.focusedNode === this
  }

  focusedIn(scope: string): boolean {
    return this.nova.events.isFocused(this, scope)
  }

  get selected(): boolean {
    return this.nova.events.isSelected(this)
  }

  selectedIn(scope: string): boolean {
    return this.nova.events.isSelected(this, scope)
  }

  //
  // STATE
  //

  get raph(): RaphApp<NovaNodeProperties> {
    return super.raph
  }

  get nova(): NovaApp<E> {
    return this._nova
  }

  get canvas(): NovaCanvas {
    return this.surface.canvas
  }

  get surface(): NovaSurface<E> {
    return this._surface! ?? (this as any as NovaSurface<E>)
  }

  get renderer(): NovaRenderer {
    return this.surface.renderer
  }

  get events(): NovaEvents<E> {
    return this.nova.events
  }

  get debugger(): NovaDebug {
    return this.nova.debugger
  }

  get localActive(): boolean {
    return this.getLocal('localActive') ?? true
  }

  get localVisible(): boolean {
    return this.getLocal('localVisible') ?? true
  }

  get renderSubtreeDirty(): boolean {
    return this._renderSubtreeDirty
  }

  get renderPolicy(): NovaRenderPolicy {
    return this._renderPolicy
  }

  set renderPolicy(value: NovaRenderPolicyInput) {
    this._renderPolicy = resolveNovaRenderPolicy(value)
    this.markRenderDirtyFlags({ cache: true })
    this.markRenderSubtreeDirty(true)
  }

  get renderDirtyFlags(): NovaRenderDirtyFlags {
    return { ...this._renderDirtyFlags }
  }

  get renderVersions(): NovaRenderVersions {
    return { ...this._renderVersions }
  }

  get renderNodeId(): string {
    return String((this as { id?: string | number }).id ?? this.__type)
  }

  get transformVersion(): number {
    return this._renderVersions.transform
  }

  get layoutVersion(): number {
    return this._renderVersions.layout
  }

  get paintVersion(): number {
    return this._renderVersions.paint
  }

  get childrenVersion(): number {
    return this._renderVersions.children
  }

  get resourceVersion(): number {
    return this._renderVersions.resource
  }

  configureRenderPolicy(value: NovaRenderPolicyInput): this {
    this.renderPolicy = value
    return this
  }

  markRenderDirtyFlags(flags: Partial<NovaRenderDirtyFlags>): void {
    mergeRenderDirtyFlags(this._renderDirtyFlags, flags)
    bumpRenderVersions(this._renderVersions, flags)
  }

  clearRenderDirtyFlags(): void {
    const clean = createCleanRenderDirtyFlags()
    Object.assign(this._renderDirtyFlags, clean)
  }

  get lifecycleState(): NovaLifecycleState {
    return this._lifecycleState
  }

  markRenderSubtreeDirty(includeChildren = false): void {
    this._renderSubtreeDirty = true

    let parent = this.parent
    while (parent instanceof NovaNode) {
      parent._renderSubtreeDirty = true
      parent = parent.parent
    }

    if (!includeChildren) return

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.markRenderSubtreeDirty(true)
      }
    }
  }

  markRenderSubtreeClean(includeChildren = false): void {
    this._renderSubtreeDirty = false
    this.clearRenderDirtyFlags()

    if (!includeChildren) return

    for (const child of this.children) {
      if (child instanceof NovaNode) {
        child.markRenderSubtreeClean(true)
      }
    }
  }

  setScale(x: number, y: number): void {
    if (this.scaleX === x && this.scaleY === y) return

    this.scaleX = x
    this.scaleY = y
  }

  setRotation(angle: number): void {
    if (this.rotation === angle) return

    this.rotation = angle
  }

  private getInverseMatrix(): mat3 | undefined {
    const matrix = this.matrix
    if (this._inverseMatrixSource === matrix) return this._inverseMatrix

    const inverse = mat3.invert(this._inverseMatrix, matrix)
    if (!inverse) return undefined

    this._inverseMatrixSource = matrix
    return this._inverseMatrix
  }

  setPosition(x: number, y: number): void {
    if (this.x === x && this.y === y) return

    this.x = x
    this.y = y
  }

  setSize(width: number, height: number): void {
    if (this.width === width && this.height === height) return

    this.width = width
    this.height = height
  }

  override dispose(): void {
    if (this._lifecycleState === 'destroyed') return

    this.nova.motion.cancel(this)
    this.unmountSubtree()
    super.dispose()
    this.offAll()
    this._orderedChildren.length = 0
    this._inverseMatrixSource = undefined
    this._renderSubtreeDirty = true
    this._lifecycleState = 'destroyed'
    this.nova.events.markSpatialDirty(this, true)
  }

  protected renderSchema(schema: NovaSchema<any>): void {
    this.setRenderBoundsFromSchema(schema)
    this.renderer.schema(schema)
  }

  protected renderSchemaOrdered(schema: NovaSchema<any>): void {
    this.setRenderBoundsFromSchema(schema)
    this.renderer.schema(schema)
  }

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
  }

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

  private resolveNodeAwareRenderer(): NovaRenderNodeAwareRenderer | null {
    const renderer = this.renderer as Partial<NovaRenderNodeAwareRenderer>
    return typeof renderer.beginNode === 'function' && typeof renderer.endNode === 'function'
      ? renderer as NovaRenderNodeAwareRenderer
      : null
  }

  override addChild(node: RaphNode<any>, options?: Parameters<RaphNode<any>['addChild']>[1]): boolean {
    if (node instanceof NovaNode) {
      if (node.lifecycleState === 'destroyed') {
        throw new Error('Нельзя повторно добавить уничтоженную Nova-ноду')
      }
      this.ensureRenderOrder(node)
    }
    const result = super.addChild(node, options)
    this.markRenderDirtyFlags({ children: true, cache: true })
    this.markRenderSubtreeDirty(false)
    if (node instanceof NovaNode) {
      if (this._lifecycleState === 'mounted' || this._lifecycleState === 'paused') {
        node.mountSubtree()
      }
      if (this._lifecycleState === 'paused') {
        node.pause()
      }
      node.markRenderSubtreeDirty(true)
    }

    return result
  }

  private ensureRenderOrder(node: NovaNode<E>): void {
    if (this._renderOrder.has(node)) return
    this._renderOrder.set(node, this._renderOrderCounter++)
  }

  private renderOrderOf(node: NovaNode<E>): number {
    this.ensureRenderOrder(node)
    return this._renderOrder.get(node)!
  }

  renderOrderIndexOf(node: NovaNode<E>): number {
    return this.renderOrderOf(node)
  }

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

  protected onMount(): void {}
  protected onUnmount(): void {}
  protected onPause(): void {}
  protected onResume(): void {}

  //
  // CHILD LOGIC
  //

  render(): void {}
  update(): void {}
}

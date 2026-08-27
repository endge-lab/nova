import type { EventList } from '@endge/utils'
import type { NovaDragEventMeta, NovaNodeEventHandlers } from '@/domain/types/events.types'
import type { NovaHitTestMode } from '@/domain/types/renderer.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import { NovaSpatialIndex } from '@/model/runtime/interaction/NovaSpatialIndex'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает тип NovaPointerDomEvent.
 */
type NovaPointerDomEvent = MouseEvent & { pointerId?: number }

/**
 * Описывает тип NovaPointerState.
 */
interface NovaPointerState<E extends EventList> {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  x: number
  y: number
  isDragging: boolean
  isDraggingEmitted: boolean
  draggedNodes: Set<NovaNode<E>>
}

const DEFAULT_POINTER_ID = 1
const DEFAULT_SCOPE = 'default'

/**
 * Управляет DOM-событиями, hit-test и маршрутизацией событий к Nova nodes.
 */
export class NovaEvents<E extends EventList> {
  interactiveNodes: Set<NovaNode<E>> = new Set()
  canvasLifecycleNodes: Set<NovaNode<E>> = new Set()
  hoveredNodes: Set<NovaNode<E>> = new Set()
  draggedNodes: Set<NovaNode<E>> = new Set()
  selectedNodes: Set<NovaNode<E>> = new Set()
  focusedNode: NovaNode<E> | null = null
  pointerCaptureNode: NovaNode<E> | null = null
  readonly selectedNodesByScope = new Map<string, Set<NovaNode<E>>>()
  readonly focusedNodesByScope = new Map<string, NovaNode<E> | null>()
  hitTestMode: NovaHitTestMode = 'linear'
  lastHitTestCandidates = 0
  lastHitTestMode: NovaHitTestMode = 'linear'

  isDragging = false
  isDraggingEmitted = false
  lastClickTime = 0
  clickTimeout: number | null = null

  startMouseX = 0
  startMouseY = 0
  lastMouseX = 0
  lastMouseY = 0
  mouseX = 0
  mouseY = 0

  clickTimeoutMs = 250

  private _mouseMoveQueued = false
  private _lastMouseMoveEvent: NovaPointerDomEvent | null = null
  private readonly _spatialIndex = new NovaSpatialIndex<E>()
  private readonly _spatialDirtyNodes = new Set<NovaNode<E>>()
  private readonly _pointerCaptureNodes = new Map<number, NovaNode<E>>()
  private readonly _pointerStates = new Map<number, NovaPointerState<E>>()
  private _spatialFullDirty = true
  private _activePointerId = DEFAULT_POINTER_ID

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(public readonly app: NovaApp<E>) {}

  /**
   * Сбрасывает внутреннее состояние к начальному виду.
   */
  reset(): void {
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout)
      this.clickTimeout = null
    }
    this.interactiveNodes.clear()
    this.canvasLifecycleNodes.clear()
    this.hoveredNodes.clear()
    this.draggedNodes.clear()
    this.selectedNodes.clear()
    this.selectedNodesByScope.clear()
    this.focusedNodesByScope.clear()
    this.focusedNode = null
    this.pointerCaptureNode = null
    this._pointerCaptureNodes.clear()
    this._pointerStates.clear()
    this._activePointerId = DEFAULT_POINTER_ID
    this.isDragging = false
    this.isDraggingEmitted = false
    this._mouseMoveQueued = false
    this._lastMouseMoveEvent = null
    this._spatialIndex.clear()
    this._spatialDirtyNodes.clear()
    this._spatialFullDirty = true
    this.lastHitTestCandidates = 0
  }

  /**
   * Помечает spatial dirty.
   */
  markSpatialDirty(node?: NovaNode<E>, includeChildren = false): void {
    if (!node) {
      this._spatialFullDirty = true
      this._spatialDirtyNodes.clear()
      return
    }

    if (this._spatialFullDirty) {
      return
    }
    this._spatialDirtyNodes.add(node)
    if (!includeChildren) {
      return
    }

    for (const child of node.children) {
      if (child instanceof NovaNode) {
        this.markSpatialDirty(child, true)
      }
    }
  }

  /**
   * Удаляет node references.
   */
  removeNodeReferences(node: NovaNode<E>): void {
    this.interactiveNodes.delete(node)
    this.canvasLifecycleNodes.delete(node)
    this._spatialDirtyNodes.delete(node)
    this._spatialIndex.remove(node)
    this.hoveredNodes.delete(node)
    this.draggedNodes.delete(node)
    this.selectedNodes.delete(node)
    for (const nodes of this.selectedNodesByScope.values()) {
      nodes.delete(node)
    }
    for (const [scope, focused] of this.focusedNodesByScope) {
      if (focused === node) {
        this.focusedNodesByScope.set(scope, null)
      }
    }
    if (this.focusedNode === node) {
      this.focusedNode = null
    }
    for (const [pointerId, captured] of this._pointerCaptureNodes) {
      if (captured === node) {
        this._pointerCaptureNodes.delete(pointerId)
      }
    }
    if (this.pointerCaptureNode === node) {
      this.pointerCaptureNode = this._firstCapturedNode()
    }
  }

  /**
   * Регистрирует interactive node и синхронизирует производные event indexes.
   */
  registerInteractiveNode(node: NovaNode<E>): void {
    this.interactiveNodes.add(node)
    if (node.eventHandlers.canvasenter || node.eventHandlers.canvasleave) {
      this.canvasLifecycleNodes.add(node)
    }
    else {
      this.canvasLifecycleNodes.delete(node)
    }
    this.markSpatialDirty(node)
  }

  /**
   * Возвращает фактическую policy spatial hit-test индекса.
   */
  get hitTestIndexPolicy(): 'rbush' {
    return 'rbush'
  }

  /**
   * Возвращает количество node в spatial hit-test индексе.
   */
  get hitTestIndexedNodeCount(): number {
    if (this.hitTestMode === 'spatial') {
      this._syncSpatialIndex()
    }
    return this._spatialIndex.indexedNodeCount
  }

  /**
   * Выполняет внутреннюю операцию handle.
   */
  handle(type: keyof NovaNodeEventHandlers, event: Event): boolean {
    if (
      this.interactiveNodes.size === 0
      && this.app.cursors.cursorNodes.size === 0
      && !this.focusedNode
      && this._pointerCaptureNodes.size === 0
    ) {
      return false
    }

    switch (type) {
      case 'mousedown':
        return this._onMouseDown(event as MouseEvent)
      case 'mousemove':
        return this._onMouseMove(event as MouseEvent)
      case 'mouseup':
        return this._onMouseUp(event as MouseEvent)
      case 'wheel':
        return this._onWheel(event as WheelEvent)
      case 'contextmenu':
        return this._onContextMenu(event as MouseEvent)
      case 'keydown':
        return this._onKeyDown(event as KeyboardEvent)
      case 'keyup':
        return this._onKeyUp(event as KeyboardEvent)
      case 'mouseenter':
        return this._onCanvasEnter(event as MouseEvent)
      case 'mouseleave':
        return this._onCanvasLeave(event as MouseEvent)
      default:
        return false
    }
  }

  // Css координаты
  /**
   * Возвращает canvas mouse position.
   */
  getCanvasMousePosition(event: MouseEvent): { x: number, y: number } {
    const rect = this.app.canvas.element.getBoundingClientRect()
    const cssX = event.clientX - rect.left
    const cssY = event.clientY - rect.top

    return {
      x: cssX,
      y: cssY,
    }
  }

  /**
   * Выполняет внутреннюю операцию hit test.
   */
  hitTest(x: number, y: number): NovaNode<E> | null {
    const candidates = this._getHitCandidates(x, y)
      .filter(node => node.active && node.visible && node.containsPoint(x, y))

    candidates.sort((a, b) => this.app.compareRenderOrder(a, b))
    return candidates[candidates.length - 1] ?? null
  }

  /**
   * Обновляет pointer capture.
   */
  setPointerCapture(node: NovaNode<E>, event?: MouseEvent): void {
    const pointerId = this._getPointerId(event)
    const previous = this._pointerCaptureNodes.get(pointerId) ?? null
    if (previous === node) {
      return
    }

    this._pointerCaptureNodes.set(pointerId, node)
    this.pointerCaptureNode = node
    if (previous) {
      this._callHandler(previous.eventHandlers.lostpointercapture, event ?? new Event('lostpointercapture'))
    }
    this._callHandler(node.eventHandlers.gotpointercapture, event ?? new Event('gotpointercapture'))
  }

  /**
   * Выполняет внутреннюю операцию release pointer capture.
   */
  releasePointerCapture(node?: NovaNode<E>, event?: MouseEvent): void {
    const pointerId = event ? this._getPointerId(event) : undefined
    const entries = pointerId !== undefined
      ? ([[pointerId, this._pointerCaptureNodes.get(pointerId)]] as Array<[number, NovaNode<E> | undefined]>)
      : [...this._pointerCaptureNodes.entries()]

    for (const [capturedPointerId, captured] of entries) {
      if (!captured || (node && captured !== node)) {
        continue
      }

      this._pointerCaptureNodes.delete(capturedPointerId)
      this._callHandler(captured.eventHandlers.lostpointercapture, event ?? new Event('lostpointercapture'))
    }

    this.pointerCaptureNode = this._firstCapturedNode()
  }

  /**
   * Проверяет наличие pointer capture.
   */
  hasPointerCapture(node: NovaNode<E>, event?: MouseEvent): boolean {
    if (event) {
      return this._pointerCaptureNodes.get(this._getPointerId(event)) === node
    }
    for (const captured of this._pointerCaptureNodes.values()) {
      if (captured === node) {
        return true
      }
    }
    return false
  }

  /**
   * Выполняет внутреннюю операцию focus.
   */
  focus(node: NovaNode<E> | null, event: Event = new Event('focus'), scope = DEFAULT_SCOPE): void {
    const previous = this._getFocusedScope(scope)
    if (previous === node) {
      return
    }

    this.focusedNodesByScope.set(scope, node)
    if (scope === DEFAULT_SCOPE) {
      this.focusedNode = node
    }
    if (previous) {
      this._callHandler(previous.eventHandlers.blur, event)
    }
    if (node) {
      this._callHandler(node.eventHandlers.focus, event)
    }
  }

  /**
   * Выполняет внутреннюю операцию blur.
   */
  blur(node?: NovaNode<E>, event: Event = new Event('blur'), scope = DEFAULT_SCOPE): void {
    const previous = this._getFocusedScope(scope)
    if (!previous || (node && previous !== node)) {
      return
    }

    this.focusedNodesByScope.set(scope, null)
    if (scope === DEFAULT_SCOPE) {
      this.focusedNode = null
    }
    this._callHandler(previous.eventHandlers.blur, event)
  }

  /**
   * Проверяет focused.
   */
  isFocused(node: NovaNode<E>, scope = DEFAULT_SCOPE): boolean {
    return this._getFocusedScope(scope) === node
  }

  /**
   * Выполняет внутреннюю операцию select.
   */
  select(node: NovaNode<E>, options: { append?: boolean, toggle?: boolean, scope?: string } = {}, event: Event = new Event('select')): void {
    const scope = options.scope ?? DEFAULT_SCOPE
    const selectedNodes = this._getSelectionScope(scope)
    if (options.toggle && selectedNodes.has(node)) {
      this.deselect(node, event, scope)
      return
    }

    if (!options.append) {
      this.clearSelection(event, scope)
    }
    if (selectedNodes.has(node)) {
      return
    }

    selectedNodes.add(node)
    this._callHandler(node.eventHandlers.select, event)
  }

  /**
   * Выполняет внутреннюю операцию deselect.
   */
  deselect(node: NovaNode<E>, event: Event = new Event('deselect'), scope = DEFAULT_SCOPE): void {
    const selectedNodes = this._getSelectionScope(scope)
    if (!selectedNodes.delete(node)) {
      return
    }

    this._callHandler(node.eventHandlers.deselect, event)
  }

  /**
   * Очищает selection.
   */
  clearSelection(event: Event = new Event('deselect'), scope = DEFAULT_SCOPE): void {
    for (const node of [...this._getSelectionScope(scope)]) {
      this.deselect(node, event, scope)
    }
  }

  /**
   * Проверяет selected.
   */
  isSelected(node: NovaNode<E>, scope = DEFAULT_SCOPE): boolean {
    return this._getSelectionScope(scope).has(node)
  }

  /**
   * Возвращает selection scope.
   */
  private _getSelectionScope(scope: string): Set<NovaNode<E>> {
    if (scope === DEFAULT_SCOPE) {
      if (!this.selectedNodesByScope.has(scope)) {
        this.selectedNodesByScope.set(scope, this.selectedNodes)
      }
      return this.selectedNodes
    }

    let selectedNodes = this.selectedNodesByScope.get(scope)
    if (!selectedNodes) {
      selectedNodes = new Set()
      this.selectedNodesByScope.set(scope, selectedNodes)
    }
    return selectedNodes
  }

  /**
   * Возвращает focused scope.
   */
  private _getFocusedScope(scope: string): NovaNode<E> | null {
    if (scope === DEFAULT_SCOPE) {
      return this.focusedNode
    }
    return this.focusedNodesByScope.get(scope) ?? null
  }

  /**
   * Возвращает hit candidates.
   */
  private _getHitCandidates(x: number, y: number): Array<NovaNode<E>> {
    this.lastHitTestMode = this.hitTestMode

    if (this.hitTestMode === 'spatial') {
      this._syncSpatialIndex()
      const candidates = this._spatialIndex.queryPoint(x, y)
      this.lastHitTestCandidates = candidates.length
      return candidates
    }

    const candidates = [...this.interactiveNodes]
    this.lastHitTestCandidates = candidates.length
    return candidates
  }

  /**
   * Синхронизирует dirty nodes с spatial hit-test индексом.
   */
  private _syncSpatialIndex(): void {
    if (this._spatialFullDirty) {
      this._spatialIndex.rebuild(this.interactiveNodes)
      this._spatialFullDirty = false
      this._spatialDirtyNodes.clear()
      return
    }

    if (this._spatialDirtyNodes.size === 0) {
      return
    }

    for (const node of this._spatialDirtyNodes) {
      if (this.interactiveNodes.has(node)) {
        this._spatialIndex.update(node)
      }
      else {
        this._spatialIndex.remove(node)
      }
    }
    this._spatialDirtyNodes.clear()
  }

  /**
   * Возвращает pointer id.
   */
  private _getPointerId(event?: MouseEvent): number {
    const pointerId = (event as NovaPointerDomEvent | undefined)?.pointerId
    return typeof pointerId === 'number' && Number.isFinite(pointerId) ? pointerId : DEFAULT_POINTER_ID
  }

  /**
   * Возвращает pointer state.
   */
  private _getPointerState(pointerId: number): NovaPointerState<E> {
    let state = this._pointerStates.get(pointerId)
    if (!state) {
      state = {
        pointerId,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        x: 0,
        y: 0,
        isDragging: false,
        isDraggingEmitted: false,
        draggedNodes: new Set(),
      }
      this._pointerStates.set(pointerId, state)
    }
    return state
  }

  /**
   * Выполняет внутреннюю операцию sync pointer state.
   */
  private _syncPointerState(state: NovaPointerState<E>): void {
    this._activePointerId = state.pointerId
    this.startMouseX = state.startX
    this.startMouseY = state.startY
    this.lastMouseX = state.lastX
    this.lastMouseY = state.lastY
    this.mouseX = state.x
    this.mouseY = state.y
    this.isDragging = state.isDragging
    this.isDraggingEmitted = state.isDraggingEmitted
    this.draggedNodes = state.draggedNodes
  }

  /**
   * Возвращает captured node.
   */
  private _getCapturedNode(event?: MouseEvent): NovaNode<E> | null {
    return this._pointerCaptureNodes.get(this._getPointerId(event)) ?? null
  }

  /**
   * Выполняет внутреннюю операцию first captured node.
   */
  private _firstCapturedNode(): NovaNode<E> | null {
    return this._pointerCaptureNodes.values().next().value ?? null
  }

  /**
   * Выполняет внутреннюю операцию dispatch pointer.
   */
  private _dispatchPointer<K extends keyof NovaNodeEventHandlers>(
    type: K,
    event: MouseEvent | WheelEvent,
    target: NovaNode<E> | null,
  ): boolean {
    if (!target) {
      return false
    }

    let handled = false
    const path = this._buildEventPath(target)
    for (const node of path.slice(0, -1)) {
      handled = this._callHandler(node.captureEventHandlers[type], event) || handled
      if (event.cancelBubble) {
        return true
      }
    }

    handled = this._callHandler(target.captureEventHandlers[type], event) || handled
    if (event.cancelBubble) {
      return true
    }

    handled = this._callHandler(target.eventHandlers[type], event) || handled
    if (event.cancelBubble) {
      return true
    }

    for (const node of path.slice(0, -1).reverse()) {
      handled = this._callHandler(node.eventHandlers[type], event) || handled
      if (event.cancelBubble) {
        return true
      }
    }

    return handled
  }

  /**
   * Выполняет внутреннюю операцию build event path.
   */
  private _buildEventPath(target: NovaNode<E>): Array<NovaNode<E>> {
    const path: Array<NovaNode<E>> = []
    let current: unknown = target

    while (current instanceof NovaNode) {
      path.unshift(current)
      current = (current as NovaNode<E>).parent
    }

    return path
  }

  /**
   * Выполняет внутреннюю операцию call handler.
   */
  private _callHandler(handler: unknown, event: MouseEvent | WheelEvent | KeyboardEvent | Event): boolean {
    if (typeof handler !== 'function') {
      return false
    }
    const result = (handler as (e: typeof event) => unknown)(event)
    if (result === false && typeof event.stopPropagation === 'function') {
      event.stopPropagation()
    }
    return true
  }

  /**
   * Выполняет внутреннюю операцию call drag handler.
   */
  private _callDragHandler(
    node: NovaNode<E>,
    type: 'dragstart' | 'dragmove' | 'dragend' | 'dragcancel',
    event: MouseEvent,
    meta: NovaDragEventMeta,
  ): void {
    const handler = node.eventHandlers[type]
    if (typeof handler !== 'function') {
      return
    }

    if (type === 'dragmove') {
      ;(handler as NonNullable<NovaNodeEventHandlers['dragmove']>)(event, meta.dx, meta.dy, meta)
      return
    }

    ;(handler as NonNullable<NovaNodeEventHandlers['dragstart']>)(event, meta)
  }

  /**
   * Создает drag meta.
   */
  private _createDragMeta(dx = 0, dy = 0): NovaDragEventMeta {
    const state = this._getPointerState(this._activePointerId)
    return {
      pointerId: state.pointerId,
      startX: state.startX,
      startY: state.startY,
      x: state.x,
      y: state.y,
      dx,
      dy,
      totalDx: state.x - state.startX,
      totalDy: state.y - state.startY,
    }
  }

  /**
   * Обрабатывает событие mouse down.
   */
  private _onMouseDown(event: MouseEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    const pointerId = this._getPointerId(event)
    const state = this._getPointerState(pointerId)
    const { x, y } = this.getCanvasMousePosition(event)
    state.startX = x
    state.startY = y
    state.x = x
    state.y = y
    state.lastX = x
    state.lastY = y
    state.isDragging = true
    state.isDraggingEmitted = false
    state.draggedNodes.clear()
    this._syncPointerState(state)

    const target = this.hitTest(x, y)
    if (target) {
      this.focus(target, event)
      state.draggedNodes.add(target)
      this._syncPointerState(state)
      this._dispatchPointer('mousedown', event, target)
      if (this.app.inputOptions.pointer.capture) {
        this.setPointerCapture(target, event)
      }
    }
    else {
      this.blur(undefined, event)
      this.clearSelection(event)
    }
    this.app.cursors.syncPointer({ x, y, target, pressed: true })
    return true
  }

  /**
   * Обрабатывает событие mouse move.
   */
  private _onMouseMove(event: MouseEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    this._lastMouseMoveEvent = event

    if (!this._mouseMoveQueued) {
      this._mouseMoveQueued = true
      requestAnimationFrame(() => {
        this._mouseMoveQueued = false
        if (this._lastMouseMoveEvent) {
          this._handleMouseMove(this._lastMouseMoveEvent)
        }
      })
    }

    return true
  }

  /**
   * Выполняет внутреннюю операцию handle mouse move.
   */
  private _handleMouseMove(event: NovaPointerDomEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    const pointerId = this._getPointerId(event)
    const state = this._getPointerState(pointerId)
    const { x, y } = this.getCanvasMousePosition(event)
    state.x = x
    state.y = y
    const dx = state.x - state.lastX
    const dy = state.y - state.lastY
    state.lastX = x
    state.lastY = y
    this._syncPointerState(state)

    const capturedTarget = this._getCapturedNode(event)
    if (capturedTarget && !state.draggedNodes.has(capturedTarget)) {
      state.draggedNodes.add(capturedTarget)
      this._syncPointerState(state)
    }

    if (state.isDragging && state.draggedNodes.size > 0) {
      const meta = this._createDragMeta(dx, dy)
      if (!state.isDraggingEmitted) {
        for (const node of state.draggedNodes) {
          this._callDragHandler(node, 'dragstart', event, meta)
          if (event.cancelBubble) {
            break
          }
        }
        state.isDraggingEmitted = true
        this._syncPointerState(state)
      }
      for (const node of state.draggedNodes) {
        this._callDragHandler(node, 'dragmove', event, meta)
        if (event.cancelBubble) {
          break
        }
      }
      if (capturedTarget && !event.cancelBubble) {
        this._dispatchPointer('mousemove', event, capturedTarget)
      }
      this.app.cursors.syncPointer({
        x,
        y,
        target: capturedTarget ?? firstSetItem(state.draggedNodes) ?? null,
        pressed: !state.isDraggingEmitted,
        dragging: state.isDraggingEmitted,
      })
      return true
    }

    const target = this.hitTest(x, y)
    const newHovered = new Set<NovaNode<E>>(target ? [target] : [])

    for (const node of this.hoveredNodes) {
      if (!newHovered.has(node)) {
        node.eventHandlers.mouseleave?.(event)
        node.eventHandlers.hover?.(event, false)
      }
    }

    if (target) {
      if (!this.hoveredNodes.has(target)) {
        target.eventHandlers.mouseenter?.(event)
        target.eventHandlers.hover?.(event, true)
      }
      if (!event.cancelBubble) {
        this._dispatchPointer('mousemove', event, target)
      }
    }

    this.hoveredNodes = newHovered
    this.app.cursors.syncPointer({ x, y, target })
    return true
  }

  /**
   * Обрабатывает событие mouse up.
   */
  private _onMouseUp(event: MouseEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    const pointerId = this._getPointerId(event)
    const state = this._getPointerState(pointerId)
    const { x, y } = this.getCanvasMousePosition(event)
    state.x = x
    state.y = y
    this._syncPointerState(state)

    const capturedTarget = this._getCapturedNode(event)
    if (state.isDraggingEmitted && state.draggedNodes.size > 0) {
      const meta = this._createDragMeta()
      for (const node of state.draggedNodes) {
        this._callDragHandler(node, 'dragend', event, meta)
        if (event.cancelBubble) {
          break
        }
      }
    }
    state.isDragging = false
    state.isDraggingEmitted = false
    state.draggedNodes.clear()
    this._syncPointerState(state)

    const mouseUpTarget = capturedTarget ?? this.hitTest(this.mouseX, this.mouseY)
    this._dispatchPointer('mouseup', event, mouseUpTarget)
    this.app.cursors.syncPointer({
      x: this.mouseX,
      y: this.mouseY,
      target: mouseUpTarget,
      pressed: false,
      dragging: false,
    })

    if (
      Math.abs(this.startMouseX - this.mouseX) <= 2
      && Math.abs(this.startMouseY - this.mouseY) <= 2
      && event.button === 0
    ) {
      const now = Date.now()
      const isDoubleClick = now - this.lastClickTime < this.clickTimeoutMs
      this.lastClickTime = now

      const x = this.mouseX
      const y = this.mouseY

      if (isDoubleClick) {
        if (this.clickTimeout) {
          clearTimeout(this.clickTimeout)
          this.clickTimeout = null
        }
        this._dispatchPointer('dblclick', event, capturedTarget ?? this.hitTest(x, y))
      }
      else {
        this.clickTimeout = window.setTimeout(() => {
          this._dispatchPointer('click', event, capturedTarget ?? this.hitTest(x, y))
          this.clickTimeout = null
        }, this.clickTimeoutMs)
      }
    }

    this.releasePointerCapture(capturedTarget ?? undefined, event)
    this._pointerStates.delete(pointerId)
    return true
  }

  /**
   * Обрабатывает событие wheel.
   */
  private _onWheel(event: WheelEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    if (event.ctrlKey || event.metaKey) {
      const { x, y } = this.getCanvasMousePosition(event)
      return this._dispatchPointer('zoom', event, this.hitTest(x, y))
    }

    const { x, y } = this.getCanvasMousePosition(event)
    return this._dispatchPointer('wheel', event, this.hitTest(x, y))
  }

  /**
   * Обрабатывает событие context menu.
   */
  private _onContextMenu(event: MouseEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    const { x, y } = this.getCanvasMousePosition(event)
    this._dispatchPointer('contextmenu', event, this.hitTest(x, y))
    return true
  }

  /**
   * Обрабатывает событие key down.
   */
  private _onKeyDown(event: KeyboardEvent): boolean {
    if (event.cancelBubble || event.repeat) {
      return false
    }

    if (this.focusedNode?.active) {
      return this._dispatchKeyboard('keydown', event, this.focusedNode)
    }

    for (const node of this.interactiveNodes) {
      if (node.active) {
        this._callHandler(node.eventHandlers.keydown, event)
        if (event.cancelBubble || event.defaultPrevented) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Обрабатывает событие key up.
   */
  private _onKeyUp(event: KeyboardEvent): boolean {
    if (event.cancelBubble) {
      return false
    }

    if (this.focusedNode?.active) {
      return this._dispatchKeyboard('keyup', event, this.focusedNode)
    }

    for (const node of this.interactiveNodes) {
      if (node.active) {
        this._callHandler(node.eventHandlers.keyup, event)
        if (event.cancelBubble || event.defaultPrevented) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Обрабатывает событие canvas enter.
   */
  private _onCanvasEnter(event: MouseEvent): boolean {
    this._mouseMoveQueued = false
    this._lastMouseMoveEvent = null
    this.isDragging = false
    this.isDraggingEmitted = false
    this.hoveredNodes.clear()
    this.draggedNodes.clear()
    this._pointerStates.clear()

    const { x, y } = this.getCanvasMousePosition(event)
    this.mouseX = x
    this.mouseY = y
    this.lastMouseX = x
    this.lastMouseY = y
    this.app.cursors.syncPointer({ x, y, target: null })

    if (event.cancelBubble) {
      return false
    }

    for (const node of [...this.canvasLifecycleNodes]) {
      if (node.active) {
        node.eventHandlers.canvasenter?.(event)
        if (event.cancelBubble) {
          break
        }
      }
    }
    return true
  }

  /**
   * Обрабатывает событие canvas leave.
   */
  private _onCanvasLeave(event: MouseEvent): boolean {
    this._mouseMoveQueued = false
    this._lastMouseMoveEvent = null

    if (this._pointerCaptureNodes.size > 0) {
      return true
    }

    if (this.isDragging && this.draggedNodes.size > 0) {
      const meta = this._createDragMeta()
      for (const node of this.draggedNodes) {
        this._callDragHandler(node, 'dragcancel', event, meta)
        if (event.cancelBubble) {
          break
        }
      }
    }

    this.isDragging = false
    this.isDraggingEmitted = false
    this._pointerStates.clear()
    for (const node of this.hoveredNodes) {
      node.eventHandlers.mouseleave?.(event)
      node.eventHandlers.hover?.(event, false)
    }
    this.hoveredNodes.clear()
    this.draggedNodes.clear()
    this.releasePointerCapture(undefined, event)
    this.app.cursors.reset()

    if (event.cancelBubble) {
      return false
    }

    for (const node of [...this.canvasLifecycleNodes]) {
      if (node.active) {
        node.eventHandlers.canvasleave?.(event)
        if (event.cancelBubble) {
          break
        }
      }
    }
    return true
  }

  /**
   * Выполняет внутреннюю операцию dispatch keyboard.
   */
  private _dispatchKeyboard(type: 'keydown' | 'keyup', event: KeyboardEvent, target: NovaNode<E>): boolean {
    const path = this._buildEventPath(target)
    for (const node of path.slice(0, -1)) {
      this._callHandler(node.captureEventHandlers[type], event)
      if (event.cancelBubble) {
        return true
      }
    }
    this._callHandler(target.eventHandlers[type], event)
    if (event.cancelBubble || event.defaultPrevented) {
      return true
    }
    for (const node of path.slice(0, -1).reverse()) {
      this._callHandler(node.eventHandlers[type], event)
      if (event.cancelBubble || event.defaultPrevented) {
        return true
      }
    }
    return false
  }
}

function firstSetItem<T>(items: Set<T>): T | undefined {
  return items.values().next().value
}

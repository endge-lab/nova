import type { EventList } from '@endge/utils'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import { NovaSpatialIndex } from '@/model/runtime/interaction/NovaSpatialIndex'
import type {
  NovaComponentCursorValue,
  NovaCursorContext,
  NovaCursorDeclaration,
  NovaCursorRule,
  NovaCursorRuntimeState,
  NovaCursorStateMap,
  NovaCursorStateName,
  NovaCursorValue,
  NovaUrlCursorValue,
} from '@/domain/types/cursor.types'

/**
 * Описывает входные данные для синхронизации cursor с pointer.
 */
export interface NovaCursorPointerSync<E extends EventList> {
  x: number
  y: number
  target: NovaNode<E> | null
  pressed?: boolean
  dragging?: boolean
}

/**
 * Централизованно выбирает cursor, обновляет DOM cursor и управляет component cursor overlay.
 */
export class NovaCursorManager<E extends EventList = Record<string, any>> {
  readonly cursorNodes = new Set<NovaNode<E>>()

  private readonly _spatialIndex = new NovaSpatialIndex<E>()
  private readonly _spatialDirtyNodes = new Set<NovaNode<E>>()
  private readonly _componentNodes = new Map<string, NovaNode<E>>()
  private _spatialFullDirty = true
  private _overlaySurface: NovaSurface<E> | null = null
  private _activeComponentKey = ''
  private _lastCursorKey = ''
  private _lastDomCursor = ''
  private _lastSource: NovaNode<E> | null = null
  private _lastState: NovaCursorRuntimeState<E> | null = null

  /**
   * Создает cursor manager для приложения.
   */
  constructor(private readonly app: NovaApp<E>) {}

  /**
   * Регистрирует node как носителя cursor declaration.
   */
  register(node: NovaNode<E>): void {
    this.cursorNodes.add(node)
    this.markSpatialDirty(node)
  }

  /**
   * Удаляет node из cursor index и active references.
   */
  unregister(node: NovaNode<E>): void {
    this.cursorNodes.delete(node)
    this._spatialDirtyNodes.delete(node)
    this._spatialIndex.remove(node)
    if (this._lastSource === node) {
      this._lastSource = null
      this.reset()
    }
  }

  /**
   * Помечает spatial index грязным.
   */
  markSpatialDirty(node?: NovaNode<E>, includeChildren = false): void {
    if (!node) {
      this._spatialFullDirty = true
      this._spatialDirtyNodes.clear()
      return
    }

    if (!this.cursorNodes.has(node) && !includeChildren) return
    if (this._spatialFullDirty) return

    if (this.cursorNodes.has(node)) this._spatialDirtyNodes.add(node)
    if (!includeChildren) return

    for (const child of node.children) {
      if (child instanceof Object && isNovaNode(child)) {
        this.markSpatialDirty(child as NovaNode<E>, true)
      }
    }
  }

  /**
   * Синхронизирует cursor с текущим pointer state.
   */
  syncPointer(input: NovaCursorPointerSync<E>): void {
    const source = this.resolveCursorSource(input.target, input.x, input.y)
    if (!source) {
      this.applyNativeCursor('default')
      this.hideActiveComponent()
      this._lastCursorKey = ''
      this._lastSource = null
      this._lastState = null
      return
    }

    const state = this.createRuntimeState(source, input)
    const value = resolveNovaCursorValue(source.cursor, state)
    if (!value) {
      this.applyNativeCursor('default')
      this.hideActiveComponent()
      this._lastCursorKey = ''
      this._lastSource = source
      this._lastState = state
      return
    }

    this.applyCursorValue(value, state)
    this._lastSource = source
    this._lastState = state
  }

  /**
   * Сбрасывает cursor в default.
   */
  reset(): void {
    this.applyNativeCursor('default')
    this.hideActiveComponent()
    this._lastCursorKey = ''
    this._lastSource = null
    this._lastState = null
  }

  /**
   * Обновляет native cursor напрямую для legacy API.
   */
  setNativeCursor(value: string): void {
    this.hideActiveComponent()
    this.applyNativeCursor(value)
    this._lastCursorKey = `legacy:${value}`
  }

  /**
   * Освобождает component cursor overlay.
   */
  destroy(): void {
    this.reset()
    for (const node of this._componentNodes.values()) {
      node.dispose()
    }
    this._componentNodes.clear()
    this._overlaySurface = null
    this.cursorNodes.clear()
    this._spatialIndex.clear()
    this._spatialDirtyNodes.clear()
  }

  /**
   * Возвращает последнюю примененную строку DOM cursor.
   */
  get lastDomCursor(): string {
    return this._lastDomCursor
  }

  /**
   * Возвращает последнюю source node.
   */
  get lastSource(): NovaNode<E> | null {
    return this._lastSource
  }

  private resolveCursorSource(target: NovaNode<E> | null, x: number, y: number): NovaNode<E> | null {
    const fromTarget = target ? this.findCursorAncestor(target) : null
    if (fromTarget) return fromTarget
    return this.cursorHitTest(x, y)
  }

  private findCursorAncestor(target: NovaNode<E>): NovaNode<E> | null {
    let current: NovaNode<E> | null = target
    while (current) {
      if (this.cursorNodes.has(current) && current.active && current.visible) return current
      const parent = current.parent
      current = isNovaNode(parent) ? parent as NovaNode<E> : null
    }
    return null
  }

  private cursorHitTest(x: number, y: number): NovaNode<E> | null {
    const candidates = this.getCursorCandidates(x, y)
      .filter(node => node.active && node.visible && node.containsPoint(x, y))

    candidates.sort((a, b) => this.app.compareRenderOrder(a, b))
    return candidates[candidates.length - 1] ?? null
  }

  private getCursorCandidates(x: number, y: number): NovaNode<E>[] {
    if (this._spatialFullDirty) {
      this._spatialIndex.rebuild(this.cursorNodes)
      this._spatialDirtyNodes.clear()
      this._spatialFullDirty = false
    } else if (this._spatialDirtyNodes.size > 0) {
      for (const node of this._spatialDirtyNodes) {
        if (this.cursorNodes.has(node)) {
          this._spatialIndex.update(node)
        } else {
          this._spatialIndex.remove(node)
        }
      }
      this._spatialDirtyNodes.clear()
    }

    return this._spatialIndex.queryPoint(x, y)
      .filter(node => this.cursorNodes.has(node))
  }

  private createRuntimeState(source: NovaNode<E>, input: NovaCursorPointerSync<E>): NovaCursorRuntimeState<E> {
    const context = source.cursorContext ?? {}
    const disabled = readDisabled(source, context)

    return {
      x: input.x,
      y: input.y,
      hover: true,
      pressed: input.pressed === true,
      dragging: input.dragging === true,
      disabled,
      target: input.target,
      source,
      context,
    }
  }

  private applyCursorValue(value: NovaCursorValue, state: NovaCursorRuntimeState<E>): void {
    const key = cursorValueKey(value)
    if (typeof value === 'object' && value.type === 'component') {
      this.applyComponentCursor(value, state, key)
      return
    }

    this.hideActiveComponent()
    this.applyNativeCursor(resolveCssCursor(value))
    this._lastCursorKey = key
  }

  private applyComponentCursor(value: NovaComponentCursorValue, state: NovaCursorRuntimeState<E>, key: string): void {
    const surface = this.resolveOverlaySurface()
    const hotspot = value.hotspot ?? { x: 0, y: 0 }
    const node = this.resolveComponentNode(surface, value, key)

    if (this._activeComponentKey && this._activeComponentKey !== key) {
      this._componentNodes.get(this._activeComponentKey)?.options({ visible: false })
    }

    node.options({
      x: state.x - hotspot.x,
      y: state.y - hotspot.y,
      visible: true,
    })
    node.dirty({ matrix: true, render: true })
    surface.dirty({ render: true })
    this.applyNativeCursor('none')
    this._activeComponentKey = key
    this._lastCursorKey = key
  }

  private resolveComponentNode(surface: NovaSurface<E>, value: NovaComponentCursorValue, key: string): NovaNode<E> {
    const existing = this._componentNodes.get(key)
    if (existing) return existing

    const node = this.app.schema.createNode(surface, {
      type: value.component,
      id: `nova-cursor:${key}`,
      props: value.props ?? {},
    }) as unknown as NovaNode<E>
    node.options({ zIndex: 1_000_000, interactive: false })
    this._componentNodes.set(key, node)
    return node
  }

  private resolveOverlaySurface(): NovaSurface<E> {
    if (this._overlaySurface) return this._overlaySurface

    const surface = this.app.createSurface2D('nova-cursor-overlay')
    surface.options({
      zIndex: 1_000_000,
      interactive: false,
    })
    this._overlaySurface = surface
    return surface
  }

  private hideActiveComponent(): void {
    if (!this._activeComponentKey) return

    const node = this._componentNodes.get(this._activeComponentKey)
    node?.options({ visible: false })
    node?.surface.dirty({ render: true })
    this._activeComponentKey = ''
  }

  private applyNativeCursor(value: string): void {
    if (this._lastDomCursor === value) return

    this.app.canvas.element.style.cursor = value
    this._lastDomCursor = value
  }
}

/**
 * Вычисляет cursor value по declaration и runtime state.
 */
export function resolveNovaCursorValue<E extends EventList>(
  declaration: NovaCursorDeclaration | null | undefined,
  state: NovaCursorRuntimeState<E>,
): NovaCursorValue | null {
  if (!declaration) return null
  if (Array.isArray(declaration)) return resolveRuleCursor(declaration, state)
  if (isCursorValue(declaration)) return declaration

  const stateMap = declaration as NovaCursorStateMap
  if (state.disabled && stateMap.disabled !== undefined) return stateMap.disabled
  if (state.dragging && stateMap.dragging !== undefined) return stateMap.dragging
  if (state.pressed && stateMap.pressed !== undefined) return stateMap.pressed
  if (state.hover && stateMap.hover !== undefined) return stateMap.hover
  return stateMap.default ?? null
}

function resolveRuleCursor<E extends EventList>(
  rules: NovaCursorRule[],
  state: NovaCursorRuntimeState<E>,
): NovaCursorValue | null {
  for (const rule of rules) {
    if (cursorRuleMatches(rule.when, state)) return rule.use
  }
  return null
}

function cursorRuleMatches<E extends EventList>(
  condition: NovaCursorRule['when'],
  state: NovaCursorRuntimeState<E>,
): boolean {
  if (!condition) return true

  const { state: requiredState, ...contextConditions } = condition
  if (requiredState !== undefined && !stateMatches(requiredState, state)) return false

  for (const [key, expected] of Object.entries(contextConditions)) {
    if (expected === undefined) continue
    if (state.context[key] !== expected) return false
  }

  return true
}

function stateMatches<E extends EventList>(
  required: NovaCursorStateName | NovaCursorStateName[],
  state: NovaCursorRuntimeState<E>,
): boolean {
  const states = Array.isArray(required) ? required : [required]
  return states.some(item => {
    if (item === 'default') return !state.disabled && !state.dragging && !state.pressed && !state.hover
    return state[item] === true
  })
}

function isCursorValue(value: NovaCursorDeclaration): value is NovaCursorValue {
  if (typeof value === 'string') return true
  if (Array.isArray(value)) return false
  if (!value || typeof value !== 'object') return false
  return value.type === 'url' || value.type === 'component'
}

function resolveCssCursor(value: NovaCursorValue): string {
  if (typeof value === 'string') return value
  if (value.type === 'url') return formatUrlCursor(value)
  return value.fallback ?? 'default'
}

function formatUrlCursor(value: NovaUrlCursorValue): string {
  const hotspot = value.hotspot ? ` ${value.hotspot.x} ${value.hotspot.y}` : ''
  return `url("${value.src}")${hotspot}, ${value.fallback ?? 'default'}`
}

function cursorValueKey(value: NovaCursorValue): string {
  if (typeof value === 'string') return `native:${value}`
  return `${value.type}:${stableStringify(value)}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`
}

function readDisabled(node: NovaNode<any>, context: NovaCursorContext): boolean {
  if (context.disabled === true) return true
  const maybeComponent = node as unknown as { getProps?: () => Record<string, unknown> }
  return maybeComponent.getProps?.().disabled === true
}

function isNovaNode(value: unknown): value is NovaNode<any> {
  return !!value && typeof value === 'object' && 'surface' in value && 'containsPoint' in value
}

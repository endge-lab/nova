import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { EventList } from '@endge/utils'

/**
 * Описывает имя состояния pointer для выбора cursor.
 */
export type NovaCursorStateName = 'default' | 'hover' | 'pressed' | 'dragging' | 'disabled'

/**
 * Описывает встроенный CSS cursor.
 */
export type NovaNativeCursor =
  | 'auto'
  | 'default'
  | 'none'
  | 'pointer'
  | 'text'
  | 'move'
  | 'grab'
  | 'grabbing'
  | 'not-allowed'
  | 'crosshair'
  | 'ew-resize'
  | 'ns-resize'
  | 'col-resize'
  | 'row-resize'
  | 'e-resize'
  | 'w-resize'
  | 'n-resize'
  | 's-resize'
  | 'ne-resize'
  | 'nw-resize'
  | 'se-resize'
  | 'sw-resize'
  | 'nesw-resize'
  | 'nwse-resize'

/**
 * Описывает hotspot cursor относительно левого верхнего угла.
 */
export interface NovaCursorHotspot {
  x: number
  y: number
}

/**
 * Описывает cursor из внешнего image/svg URL.
 */
export interface NovaUrlCursorValue {
  type: 'url'
  src: string
  hotspot?: NovaCursorHotspot
  fallback?: NovaNativeCursor | string
}

/**
 * Описывает cursor как зарегистрированный Nova schema component.
 */
export interface NovaComponentCursorValue {
  type: 'component'
  component: string
  props?: Record<string, unknown>
  hotspot?: NovaCursorHotspot
  fallback?: NovaNativeCursor | string
}

/**
 * Описывает конкретное значение cursor.
 */
export type NovaCursorValue =
  | NovaNativeCursor
  | (string & {})
  | NovaUrlCursorValue
  | NovaComponentCursorValue

/**
 * Описывает state-map форму cursor declaration.
 */
export interface NovaCursorStateMap {
  default?: NovaCursorValue
  hover?: NovaCursorValue
  pressed?: NovaCursorValue
  dragging?: NovaCursorValue
  disabled?: NovaCursorValue
}

/**
 * Описывает значение контекста cursor rule.
 */
export type NovaCursorContextValue = string | number | boolean

/**
 * Описывает условие cursor rule.
 */
export interface NovaCursorRuleCondition extends Record<string, NovaCursorContextValue | NovaCursorStateName | NovaCursorStateName[] | undefined> {
  state?: NovaCursorStateName | NovaCursorStateName[]
}

/**
 * Описывает rule-форму cursor declaration.
 */
export interface NovaCursorRule {
  when?: NovaCursorRuleCondition
  use: NovaCursorValue
}

/**
 * Описывает декларативный cursor для Nova node.
 */
export type NovaCursorDeclaration =
  | NovaCursorValue
  | NovaCursorStateMap
  | NovaCursorRule[]

/**
 * Описывает контекст cursor rule на node.
 */
export type NovaCursorContext = Record<string, NovaCursorContextValue>

/**
 * Описывает runtime state pointer для выбора cursor.
 */
export interface NovaCursorRuntimeState<E extends EventList = Record<string, any>> {
  x: number
  y: number
  hover: boolean
  pressed: boolean
  dragging: boolean
  disabled: boolean
  target: NovaNode<E> | null
  source: NovaNode<E> | null
  context: NovaCursorContext
}

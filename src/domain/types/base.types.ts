import type { RaphProperties , RaphKernel , RaphSchedulerType } from '@endge/raph'
import type { mat3 } from 'gl-matrix'
import type { EventList } from '@endge/utils'
import type { RendererType } from '@/domain/types/renderer.types'
import type { NovaRendererConfigInput } from '@/domain/types/rendering/index'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaSoundOptions } from '@/domain/types/sound.types'
import type { NovaCursorContext, NovaCursorDeclaration } from '@/domain/types/cursor.types'

/**
 * Описывает контракт NovaNodeProperties.
 */
export interface NovaNodeProperties extends RaphProperties {
  // Локальное состояние ноды. Не наследуется от родителя.
  localActive: boolean
  localVisible: boolean

  // Фаза - preupdate
  interactive: boolean
  propagateUpdate: boolean
  cursor: NovaCursorDeclaration | null
  cursorContext: NovaCursorContext | null

  // Фаза - update. Вычисляется из localActive и active родителя.
  active: boolean

  // Фаза - matrix
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number

  //
  matrix: mat3

  // Фаза - render. Вычисляется из localVisible и visible родителя.
  visible: boolean
  opacity: number
  width: number
  height: number
}

/**
 * Описывает контракт NovaAppOptions.
 */
export interface NovaAppOptions {
  debug: boolean | string | Array<string>

  loop: boolean
  width: number
  height: number
  dpr: number
  maxDpr: number
}

/**
 * Описывает тип NovaCanvasTarget.
 */
export type NovaCanvasTarget = HTMLCanvasElement

/**
 * Описывает контракт NovaSizeOptions.
 */
export interface NovaSizeOptions {
  width: number
  height: number
  dpr?: number
  maxDpr?: number
}

/**
 * Описывает тип NovaPointerScope.
 */
export type NovaPointerScope = 'target'
/**
 * Описывает тип NovaKeyboardScope.
 */
export type NovaKeyboardScope = 'focused' | 'active' | 'hovered' | 'global' | 'manual'
/**
 * Описывает тип NovaInputPreventDefault.
 */
export type NovaInputPreventDefault = 'never' | 'handled' | 'always'

/**
 * Описывает контракт NovaPointerInputOptions.
 */
export interface NovaPointerInputOptions {
  enabled?: boolean
  scope?: NovaPointerScope
  capture?: boolean
}

/**
 * Описывает контракт NovaKeyboardInputOptions.
 */
export interface NovaKeyboardInputOptions {
  enabled?: boolean
  scope?: NovaKeyboardScope
  preventDefault?: NovaInputPreventDefault
  ignoreEditableTargets?: boolean
}

/**
 * Описывает контракт NovaInputOptions.
 */
export interface NovaInputOptions {
  pointer?: NovaPointerInputOptions
  keyboard?: NovaKeyboardInputOptions
}

/**
 * Описывает контракт ResolvedNovaInputOptions.
 */
export interface ResolvedNovaInputOptions {
  pointer: {
    enabled: boolean
    capture: boolean
  }
  keyboard: {
    enabled: boolean
    scope: NovaKeyboardScope
    preventDefault: NovaInputPreventDefault
    ignoreEditableTargets: boolean
  }
}

/**
 * Описывает контракт NovaRendererOptions.
 */
export interface NovaRendererOptions {
  main?: RendererType
  webgl?: WebGLContextAttributes
  config?: NovaRendererConfigInput
}

/**
 * Описывает контракт NovaSchedulerOptions.
 */
export interface NovaSchedulerOptions {
  type?: RaphSchedulerType
  loop?: boolean
}

/**
 * Описывает контракт NovaDebugOptions.
 */
export interface NovaDebugOptions {
  enabled?: boolean | string | Array<string>
  telemetry?: boolean
  overlay?: boolean
}

/**
 * Описывает настройки подключения NovaApp к Raph runtime/kernel.
 */
export interface NovaRaphOptions {
  kernel?: RaphKernel
  runtimeId?: string
}

/**
 * Описывает контракт NovaAppCreateOptions.
 */
export interface NovaAppCreateOptions<E extends EventList = Record<string, any>> {
  target: NovaCanvasTarget
  size: NovaSizeOptions
  input?: NovaInputOptions
  renderer?: NovaRendererOptions
  scheduler?: NovaSchedulerOptions
  sound?: NovaSoundOptions
  debug?: NovaDebugOptions
  raph?: NovaRaphOptions
  predefinedEvents?: Array<keyof E>
  schemaRegistry?: NovaSchemaRegistry
}

/**
 * Описывает тип NovaCanvasOwnership.
 */
export type NovaCanvasOwnership = 'external' | 'internal'

/**
 * Описывает контракт NovaCanvasCreateOptions.
 */
export interface NovaCanvasCreateOptions extends Partial<NovaSizeOptions> {
  webgl?: WebGLContextAttributes
  contextType?: RendererType
}

import type { RaphProperties } from '@endge/raph'
import type { RaphSchedulerType } from '@endge/raph'
import type { mat3 } from 'gl-matrix'
import type { RendererType } from '@/domain/types/renderer-types'
import type { EventList } from '@endge/utils'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'

export interface NovaNodeProperties extends RaphProperties {
  // Локальное состояние ноды. Не наследуется от родителя.
  localActive: boolean
  localVisible: boolean

  // Фаза - preupdate
  interactive: boolean
  propagateUpdate: boolean

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

export interface NovaAppOptions {
  debug: boolean | string | string[]

  loop: boolean
  width: number
  height: number
  dpr: number
  maxDpr: number
}

export type NovaCanvasTarget = HTMLCanvasElement

export interface NovaSizeOptions {
  width: number
  height: number
  dpr?: number
  maxDpr?: number
}

export type NovaPointerScope = 'target'
export type NovaKeyboardScope = 'focused' | 'active' | 'hovered' | 'global' | 'manual'
export type NovaInputPreventDefault = 'never' | 'handled' | 'always'

export interface NovaPointerInputOptions {
  enabled?: boolean
  scope?: NovaPointerScope
  capture?: boolean
}

export interface NovaKeyboardInputOptions {
  enabled?: boolean
  scope?: NovaKeyboardScope
  preventDefault?: NovaInputPreventDefault
  ignoreEditableTargets?: boolean
}

export interface NovaInputOptions {
  pointer?: NovaPointerInputOptions
  keyboard?: NovaKeyboardInputOptions
}

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

export interface NovaRendererOptions {
  main?: RendererType
  defaultSurface?: RendererType
  webgl?: WebGLContextAttributes
}

export interface NovaSchedulerOptions {
  type?: RaphSchedulerType
  loop?: boolean
}

export interface NovaDebugOptions {
  enabled?: boolean | string | string[]
  telemetry?: boolean
  overlay?: boolean
}

export interface NovaAppCreateOptions<E extends EventList = Record<string, any>> {
  target: NovaCanvasTarget
  size: NovaSizeOptions
  input?: NovaInputOptions
  renderer?: NovaRendererOptions
  scheduler?: NovaSchedulerOptions
  debug?: NovaDebugOptions
  predefinedEvents?: (keyof E)[]
  schemaRegistry?: NovaSchemaRegistry
}

export type NovaCanvasOwnership = 'external' | 'internal'

export interface NovaCanvasCreateOptions extends Partial<NovaSizeOptions> {
  webgl?: WebGLContextAttributes
}

export interface SurfaceOptions {
  width: number
  height: number
  zIndex: number
  active: boolean
  interactive: boolean
  cache: boolean
}

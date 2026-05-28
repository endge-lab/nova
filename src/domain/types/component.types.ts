import type { EventList } from '@endge/utils'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaBounds, NovaRenderer, NovaSchema } from '@/domain/types/renderer.types'

/**
 * Описывает тип NovaSchemaDescriptorKind.
 */
export type NovaSchemaDescriptorKind = 'primitive' | 'schema-component' | 'node-component'
/**
 * Описывает тип NovaSchemaRenderMode.
 */
export type NovaSchemaRenderMode = 'schema' | 'batched' | 'ordered'
/**
 * Описывает тип NovaComponentDirtyPhase.
 */
export type NovaComponentDirtyPhase = 'update' | 'render' | 'matrix'

/**
 * Constructor runtime-компонента, который может быть создан напрямую без string registry key.
 */
export type NovaElementConstructor<E extends EventList = Record<string, any>> = new (
  app: NovaApp<E>,
  surface: NovaSurface<E>,
  props?: Record<string, any>,
  listeners?: Record<string, (...args: Array<any>) => void>,
  slots?: NovaElementSlots,
) => NovaNode<E>

/**
 * Фабрика named slot, которая строит schema snapshot по публичному scope.
 */
export type NovaElementSlotFactory<TScope = Record<string, any>> = (scope?: TScope) => Array<NovaElementSchema<any>>

/**
 * Набор named slots для runtime component schema.
 */
export type NovaElementSlots = Record<string, NovaElementSlotFactory<any>>

/**
 * Тип компонента в runtime trees: string schema type или прямой constructor.
 */
export type NovaElementType<E extends EventList = Record<string, any>> = string | NovaElementConstructor<E>

/**
 * Описывает контракт NovaComponentDirtyPolicy.
 */
export type NovaComponentDirtyPath<TProps extends Record<string, any> = Record<string, any>> = keyof TProps | string

/**
 * Описывает контракт NovaComponentDirtyPolicy.
 */
export interface NovaComponentDirtyPolicy<TProps extends Record<string, any> = Record<string, any>> {
  update?: ReadonlyArray<NovaComponentDirtyPath<TProps>>
  render?: ReadonlyArray<NovaComponentDirtyPath<TProps>>
  matrix?: ReadonlyArray<NovaComponentDirtyPath<TProps>>
}

/**
 * Описывает kind prop-декоратора.
 */
export type NovaComponentPropKind = 'model' | 'object' | 'options' | 'array' | 'string' | 'number' | 'boolean' | 'function'

/**
 * Описывает prop metadata class-компонента.
 */
export interface NovaComponentPropDefinition {
  key: string
  propertyKey?: string
  kind: NovaComponentPropKind
  required?: boolean
  defaultValue?: unknown | (() => unknown)
  mode?: 'plain' | 'versioned'
  event?: boolean
}

/**
 * Описывает watcher metadata class-компонента.
 */
export interface NovaComponentWatchDefinition {
  path: string
  methodName: string
  phase: 'update' | 'render' | 'matrix'
  immediate?: boolean
}

/**
 * Описывает command metadata class-компонента.
 */
export interface NovaComponentCommandDefinition {
  id: string
  methodName: string
  scope?: string
}

/**
 * Описывает API metadata class-компонента.
 */
export interface NovaComponentApiDefinition {
  methodName: string
}

/**
 * Описывает контракт NovaComponentSchema.
 */
export interface NovaComponentSchema<TSchema = Record<string, any>> {
  type: string
  id?: string
  props?: Partial<TSchema> & Record<string, any>
  slots?: NovaElementSlots
  [key: string]: any
}

/**
 * Описывает runtime tree schema item, который может ссылаться на string type или constructor.
 */
export interface NovaElementSchema<
  TSchema = Record<string, any>,
  TType extends NovaElementType = NovaElementType,
> extends Omit<NovaComponentSchema<TSchema>, 'type'> {
  type: TType
}

/**
 * Описывает runtime component node, доступный через app.components.
 */
export interface NovaRuntimeComponentNode {
  componentId: string
  getApi: () => unknown
}

/**
 * Описывает контракт NovaSchemaRenderContext.
 */
export interface NovaSchemaRenderContext {
  renderer: NovaRenderer
  registry: NovaSchemaRegistry
  depth: number
}

/**
 * Описывает контракт NovaSchemaBoundsContext.
 */
export interface NovaSchemaBoundsContext {
  registry: NovaSchemaRegistry
  depth: number
}

/**
 * Описывает контракт NovaComponentCreateContext.
 */
export interface NovaComponentCreateContext<E extends EventList = Record<string, any>> {
  app: NovaApp<E>
  surface: NovaSurface<E>
  registry: NovaSchemaRegistry
  parent?: NovaNode<E>
  context?: unknown
}

/**
 * Описывает контракт NovaComponentDescriptor.
 */
export interface NovaComponentDescriptor<
  TProps extends Record<string, any> = Record<string, any>,
  TApi = unknown,
  TEvents extends Record<string, unknown> = Record<string, unknown>,
  TSchema = TProps,
> {
  type: string
  name: string
  title?: string
  version: string
  kind: NovaSchemaDescriptorKind
  dirtyPolicy?: NovaComponentDirtyPolicy<TProps>
  propDefinitions?: ReadonlyArray<NovaComponentPropDefinition>
  watchDefinitions?: ReadonlyArray<NovaComponentWatchDefinition>
  commandDefinitions?: ReadonlyArray<NovaComponentCommandDefinition>
  apiDefinitions?: ReadonlyArray<NovaComponentApiDefinition>
  bounds?: 'size' | 'custom'
  fields?: unknown
  api?: unknown | TApi
  events?: unknown | TEvents
  normalize?: (schema: NovaComponentSchema<TSchema>) => TProps
  renderSchema?: (ctx: NovaSchemaRenderContext, schema: NovaComponentSchema<TSchema>) => NovaSchema<any> | void
  measureBounds?: (ctx: NovaSchemaBoundsContext, schema: NovaComponentSchema<TSchema>) => NovaBounds | null
  createNode?: <E extends EventList>(
    ctx: NovaComponentCreateContext<E>,
    schema: NovaComponentSchema<TSchema>,
  ) => NovaNode<E>
}

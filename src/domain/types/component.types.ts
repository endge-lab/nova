import type { EventList } from '@endge/utils'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
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
) => NovaNode<E>

/**
 * Тип компонента в runtime trees: string schema type или прямой constructor.
 */
export type NovaElementType<E extends EventList = Record<string, any>> = string | NovaElementConstructor<E>

/**
 * Описывает контракт NovaComponentDirtyPolicy.
 */
export interface NovaComponentDirtyPolicy<TProps extends Record<string, any> = Record<string, any>> {
  update?: ReadonlyArray<keyof TProps>
  render?: ReadonlyArray<keyof TProps>
  matrix?: ReadonlyArray<keyof TProps>
}

/**
 * Описывает контракт NovaComponentSchema.
 */
export interface NovaComponentSchema<TSchema = Record<string, any>> {
  type: string
  id?: string
  props?: Partial<TSchema> & Record<string, any>
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
  fields?: unknown
  api?: unknown
  events?: unknown
  normalize?: (schema: NovaComponentSchema<TSchema>) => TProps
  renderSchema?: (ctx: NovaSchemaRenderContext, schema: NovaComponentSchema<TSchema>) => NovaSchema<any> | void
  measureBounds?: (ctx: NovaSchemaBoundsContext, schema: NovaComponentSchema<TSchema>) => NovaBounds | null
  createNode?: <E extends EventList>(
    ctx: NovaComponentCreateContext<E>,
    schema: NovaComponentSchema<TSchema>,
  ) => NovaComponentNode<TProps, TApi, TEvents, TSchema, E>
}

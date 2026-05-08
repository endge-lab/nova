import type { NovaApp } from '@/model/app/NovaApp'
import type { NovaComponentNode } from '@/model/core/NovaComponentNode'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import type { NovaSurface } from '@/model/core/NovaSurface'
import type { NovaBounds, NovaRenderer, NovaSchema } from '@/domain/types/renderer-types'
import type { EventList } from '@endge/utils'

export type NovaSchemaDescriptorKind = 'primitive' | 'schema-component' | 'node-component'
export type NovaSchemaRenderMode = 'schema' | 'batched' | 'ordered'
export type NovaComponentDirtyPhase = 'update' | 'render' | 'matrix'

export interface NovaComponentDirtyPolicy<TProps extends Record<string, any> = Record<string, any>> {
  update?: readonly (keyof TProps)[]
  render?: readonly (keyof TProps)[]
  matrix?: readonly (keyof TProps)[]
}

export interface NovaComponentSchema<TSchema = Record<string, any>> {
  type: string
  id?: string
  props?: Partial<TSchema> & Record<string, any>
  [key: string]: any
}

export interface NovaSchemaRenderContext {
  renderer: NovaRenderer
  registry: NovaSchemaRegistry
  depth: number
}

export interface NovaSchemaBoundsContext {
  registry: NovaSchemaRegistry
  depth: number
}

export interface NovaComponentCreateContext<E extends EventList = Record<string, any>> {
  app: NovaApp<E>
  surface: NovaSurface<E>
  registry: NovaSchemaRegistry
}

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

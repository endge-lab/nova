import type { NovaComponentCreateContext, NovaComponentDescriptor, NovaComponentSchema, NovaSchemaRenderMode } from '@/domain/types/component-types'
import type { NovaComponentNode } from '@/model/core/NovaComponentNode'
import type { NovaRenderer } from '@/domain/types/renderer-types'
import type { NovaSurface } from '@/model/core/NovaSurface'
import type { NovaNode } from '@/model/core/NovaNode'
import type { EventList } from '@endge/utils'

const MAX_SCHEMA_COMPONENT_DEPTH = 32

export class NovaSchemaRegistry {
  private readonly _descriptors = new Map<string, NovaComponentDescriptor<any, any, any, any>>()

  constructor(options: { defaults?: boolean } = {}) {
    if (options.defaults ?? true) {
      this.registerDefaults()
    }
  }

  register<TProps extends Record<string, any>, TApi, TEvents extends Record<string, unknown>, TSchema>(
    descriptor: NovaComponentDescriptor<TProps, TApi, TEvents, TSchema>,
    options: { override?: boolean } = {},
  ): void {
    const existing = this._descriptors.get(descriptor.type)
    if (existing && existing !== descriptor && !options.override) {
      throw new Error(`[NovaSchemaRegistry] Schema type "${descriptor.type}" is already registered`)
    }

    this._descriptors.set(descriptor.type, descriptor)
  }

  has(type: string): boolean {
    return this._descriptors.has(type)
  }

  resolve<T extends NovaComponentDescriptor<any, any, any, any> = NovaComponentDescriptor<any, any, any, any>>(
    type: string,
  ): T | undefined {
    return this._descriptors.get(type) as T | undefined
  }

  renderSchemaComponent(
    renderer: NovaRenderer,
    item: NovaComponentSchema<any>,
    mode: NovaSchemaRenderMode,
    depth = 0,
  ): boolean {
    const descriptor = this.resolve(item.type)
    if (!descriptor || descriptor.kind === 'primitive' || !descriptor.renderSchema) return false
    if (depth > MAX_SCHEMA_COMPONENT_DEPTH) {
      throw new Error(`[NovaSchemaRegistry] Max schema component depth exceeded at "${item.type}"`)
    }

    const nested = descriptor.renderSchema({ renderer, registry: this, depth }, item)
    if (!nested?.length) return true

    if (mode === 'ordered') {
      renderer.schemaOrdered(nested)
    } else if (mode === 'batched') {
      renderer.schemaBatched(nested)
    } else {
      renderer.schema(nested)
    }

    return true
  }

  createNode<E extends EventList>(
    surface: NovaSurface<E>,
    schema: NovaComponentSchema<any>,
  ): NovaComponentNode<any, any, any, any, E> {
    const node = this.createDetachedNode(surface, schema)
    surface.addChild(node)
    return node
  }

  createChild<E extends EventList>(
    parent: NovaNode<E>,
    schema: NovaComponentSchema<any>,
  ): NovaComponentNode<any, any, any, any, E> {
    const node = this.createDetachedNode(parent.surface, schema)
    parent.addChild(node)
    return node
  }

  private createDetachedNode<E extends EventList>(
    surface: NovaSurface<E>,
    schema: NovaComponentSchema<any>,
  ): NovaComponentNode<any, any, any, any, E> {
    const descriptor = this.resolve(schema.type)
    if (!descriptor) {
      throw new Error(`[NovaSchemaRegistry] Schema type "${schema.type}" is not registered`)
    }
    if (descriptor.kind !== 'node-component' || !descriptor.createNode) {
      throw new Error(`[NovaSchemaRegistry] Schema type "${schema.type}" is not a node component`)
    }

    const node = descriptor.createNode(
      {
        app: surface.nova,
        surface,
        registry: this,
      } as NovaComponentCreateContext<E>,
      schema,
    )
    return node
  }

  private registerDefaults(): void {
    for (const type of ['rect', 'border', 'text', 'line', 'circle', 'polygon', 'icon']) {
      this.register({
        type,
        name: type,
        version: '1.0.0',
        kind: 'primitive',
      })
    }
  }
}

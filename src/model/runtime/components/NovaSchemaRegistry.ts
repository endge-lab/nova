import type { EventList } from '@endge/utils'
import type { NovaComponentCreateContext, NovaComponentDescriptor, NovaComponentSchema, NovaSchemaRenderMode } from '@/domain/types/component.types'
import type { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
import type { NovaRenderer } from '@/domain/types/renderer.types'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaNodeContextOptions } from '@/domain/types/context.types'

const MAX_SCHEMA_COMPONENT_DEPTH = 32

/**
 * Хранит schema components и отвечает за их expansion и bounds resolution.
 */
export class NovaSchemaRegistry {
  private readonly _descriptors = new Map<string, NovaComponentDescriptor<any, any, any, any>>()

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(options: { defaults?: boolean } = {}) {
    if (options.defaults ?? true) {
      this.registerDefaults()
    }
  }

  /**
   * Выполняет внутреннюю операцию register.
   */
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

  /**
   * Выполняет внутреннюю операцию has.
   */
  has(type: string): boolean {
    return this._descriptors.has(type)
  }

  /**
   * Выполняет внутреннюю операцию resolve.
   */
  resolve<T extends NovaComponentDescriptor<any, any, any, any> = NovaComponentDescriptor<any, any, any, any>>(
    type: string,
  ): T | undefined {
    return this._descriptors.get(type) as T | undefined
  }

  /**
   * Выполняет render-операцию schema component.
   */
  renderSchemaComponent(
    renderer: NovaRenderer,
    item: NovaComponentSchema<any>,
    _mode: NovaSchemaRenderMode,
    depth = 0,
  ): boolean {
    const descriptor = this.resolve(item.type)
    if (!descriptor || descriptor.kind === 'primitive' || !descriptor.renderSchema) return false
    if (depth > MAX_SCHEMA_COMPONENT_DEPTH) {
      throw new Error(`[NovaSchemaRegistry] Max schema component depth exceeded at "${item.type}"`)
    }

    const nested = descriptor.renderSchema({ renderer, registry: this, depth }, item)
    if (!nested?.length) return true

    renderer.schema(nested)

    return true
  }

  /**
   * Создает node.
   */
  createNode<E extends EventList>(
    surface: NovaSurface<E>,
    schema: NovaComponentSchema<any>,
    options: NovaNodeContextOptions = {},
  ): NovaComponentNode<any, any, any, any, E> {
    const node = this.createDetachedNode(surface, schema, options)
    surface.addChild(node, options)
    return node
  }

  /**
   * Создает child.
   */
  createChild<E extends EventList>(
    parent: NovaNode<E>,
    schema: NovaComponentSchema<any>,
    options: NovaNodeContextOptions = {},
  ): NovaComponentNode<any, any, any, any, E> {
    const node = this.createDetachedNode(parent.surface, schema, {
      ...options,
      parent,
    })
    parent.addChild(node, options)
    return node
  }

  /**
   * Создает detached node.
   */
  private createDetachedNode<E extends EventList>(
    surface: NovaSurface<E>,
    schema: NovaComponentSchema<any>,
    options: NovaNodeContextOptions & { parent?: NovaNode<E> } = {},
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
        parent: options.parent,
        context: options.context,
      } as NovaComponentCreateContext<E>,
      schema,
    )
    if (Object.prototype.hasOwnProperty.call(options, 'context')) {
      node.setContext(options.context)
    }
    return node
  }

  /**
   * Регистрирует defaults.
   */
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

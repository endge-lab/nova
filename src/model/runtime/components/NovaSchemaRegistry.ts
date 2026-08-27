import type { EventList } from '@endge/utils'
import type {
  NovaComponentCreateContext,
  NovaComponentDescriptor,
  NovaComponentSchema,
  NovaElementConstructor,
  NovaElementSchema,
  NovaSchemaRenderMode,
} from '@/domain/types/component.types'
import type { NovaNodeContextOptions } from '@/domain/types/context.types'
import type { NovaRenderer } from '@/domain/types/renderer.types'
import type { NovaDefinedComponentInput } from '@/model/runtime/components/nova-defined-component'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import {
  createDefinedComponentNode,
  normalizeDefinedComponent,

} from '@/model/runtime/components/nova-defined-component'
import { registerNovaSceneComponents } from '@/model/runtime/scene/nova-scene-components'

const MAX_SCHEMA_COMPONENT_DEPTH = 32

/**
 * Хранит schema components и отвечает за их expansion и bounds resolution.
 */
export class NovaSchemaRegistry {
  private readonly _descriptors = new Map<string, NovaComponentDescriptor<any, any, any, any>>()
  private readonly _tagDescriptors = new Map<string, NovaComponentDescriptor<any, any, any, any>>()
  private readonly _reservedTags = new Set<string>()

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(options: { defaults?: boolean } = {}) {
    if (options.defaults ?? true) {
      this._registerDefaults()
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
   * Регистрирует class-компонент с optional global tag.
   */
  registerDefinedComponent<E extends EventList = Record<string, any>>(
    input: NovaElementConstructor<E> | NovaDefinedComponentInput<E>,
    options: { override?: boolean } = {},
  ): void {
    const definition = normalizeDefinedComponent(input)
    const tag = definition.tag
    if (!tag && !definition.descriptor?.type) {
      throw new Error(`[NovaSchemaRegistry] Defined component "${definition.name}" requires a global tag for registration`)
    }
    if (tag && this._reservedTags.has(tag) && !options.override) {
      throw new Error(`[NovaSchemaRegistry] Tag "${tag}" is reserved and cannot be registered`)
    }

    const descriptor: NovaComponentDescriptor<Record<string, any>, unknown, Record<string, unknown>, Record<string, any>> = definition.descriptor ?? {
      type: `nova.component:${tag}`,
      name: definition.name,
      version: definition.version,
      kind: 'node-component',
      createNode: (context, schema) => createDefinedComponentNode(definition.component as any, context as any, {
        schema: schema as NovaComponentSchema<Record<string, any>>,
        componentId: schema.id,
      }) as any,
    }

    this.register(descriptor, options)

    if (!tag) {
      return
    }
    const existing = this._tagDescriptors.get(tag)
    if (existing && existing !== descriptor && !options.override) {
      throw new Error(`[NovaSchemaRegistry] Tag "${tag}" is already registered`)
    }
    this._tagDescriptors.set(tag, descriptor)
  }

  /**
   * Регистрирует decorated class-component напрямую без ручного descriptor/registry glue.
   */
  registerDecorated<E extends EventList = Record<string, any>>(
    input: NovaElementConstructor<E> | NovaDefinedComponentInput<E>,
    options: { override?: boolean } = {},
  ): void {
    this.registerDefinedComponent(input, options)
  }

  /**
   * Помечает tag как занятый builtin-слоем или compiler semantics.
   */
  reserveTag(tag: string): void {
    this._reservedTags.add(tag)
  }

  /**
   * Выполняет внутреннюю операцию has.
   */
  has(type: string): boolean {
    return this._descriptors.has(type) || this._tagDescriptors.has(type)
  }

  /**
   * Выполняет внутреннюю операцию resolve.
   */
  resolve<T extends NovaComponentDescriptor<any, any, any, any> = NovaComponentDescriptor<any, any, any, any>>(
    type: string,
  ): T | undefined {
    return (this._descriptors.get(type) ?? this._tagDescriptors.get(type)) as T | undefined
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
    if (!descriptor || descriptor.kind === 'primitive' || !descriptor.renderSchema) {
      return false
    }
    if (depth > MAX_SCHEMA_COMPONENT_DEPTH) {
      throw new Error(`[NovaSchemaRegistry] Max schema component depth exceeded at "${item.type}"`)
    }

    const nested = descriptor.renderSchema({ renderer, registry: this, depth }, item)
    if (!nested?.length) {
      return true
    }

    renderer.schema(nested)

    return true
  }

  /**
   * Создает node.
   */
  createNode<E extends EventList>(
    surface: NovaSurface<E>,
    schema: NovaElementSchema<any>,
    options: NovaNodeContextOptions = {},
  ): NovaNode<E> {
    const node = this._createDetachedNode(surface, schema, options)
    surface.addChild(node, options)
    return node
  }

  /**
   * Создает child.
   */
  createChild<E extends EventList>(
    parent: NovaNode<E>,
    schema: NovaElementSchema<any>,
    options: NovaNodeContextOptions = {},
  ): NovaNode<E> {
    const node = this._createDetachedNode(parent.surface, schema, {
      ...options,
      parent,
    })
    parent.addChild(node, options)
    return node
  }

  /**
   * Создает detached node.
   */
  private _createDetachedNode<E extends EventList>(
    surface: NovaSurface<E>,
    schema: NovaElementSchema<any>,
    options: NovaNodeContextOptions & { parent?: NovaNode<E> } = {},
  ): NovaNode<E> {
    if (typeof schema.type !== 'string') {
      return createDefinedComponentNode(schema.type as any, {
        app: surface.nova,
        surface,
        registry: this,
        parent: options.parent,
        context: options.context,
      } as NovaComponentCreateContext<E>, {
        schema: {
          ...schema,
          type: schema.type.name || 'AnonymousComponent',
        },
        componentId: schema.id,
        slots: schema.slots,
      })
    }

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
      schema as NovaComponentSchema<any>,
    )
    if (Object.hasOwn(options, 'context')) {
      node.setContext(options.context)
    }
    return node
  }

  /**
   * Регистрирует defaults.
   */
  private _registerDefaults(): void {
    for (const type of ['rect', 'border', 'text', 'line', 'circle', 'polygon', 'icon']) {
      this.reserveTag(type)
      this.register({
        type,
        name: type,
        version: '1.0.0',
        kind: 'primitive',
      })
    }

    registerNovaSceneComponents(this)
  }
}

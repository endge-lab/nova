import type { EventList, OneOrMany } from '@endge/utils'
import type {
  NovaComponentCreateContext,
  NovaComponentDescriptor,
  NovaComponentSchema,
  NovaElementConstructor,
  NovaElementSlots,
  NovaRuntimeComponentNode,
} from '@/domain/types/component.types'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import {
  createNovaDecoratedComponentDescriptor,
  readNovaDecoratedComponent,
} from '@/model/runtime/components/nova-component-metadata'
import { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'

const NOVA_DEFINED_COMPONENT_SYMBOL = Symbol('nova.defined-component')
const NOVA_RUNTIME_COMPONENT_SYMBOL = Symbol('nova.runtime-component')

export interface NovaComponentListeners {
  [key: string]: (...args: Array<any>) => void
}

export interface NovaDefinedComponentOptions<E extends EventList = Record<string, any>> {
  tag?: string
  name?: string
  version?: string
  createNode?: (
    context: NovaComponentCreateContext<E>,
    schema: NovaComponentSchema<Record<string, any>>,
  ) => NovaNode<E>
}

export interface NovaDefinedComponentInput<E extends EventList = Record<string, any>> extends NovaDefinedComponentOptions<E> {
  component: NovaElementConstructor<E>
}

export interface NovaNormalizedDefinedComponent<E extends EventList = Record<string, any>> {
  component: NovaElementConstructor<E>
  tag?: string
  name: string
  version: string
  descriptor?: NovaComponentDescriptor<any, any, any, any>
  createNode?: (
    context: NovaComponentCreateContext<E>,
    schema: NovaComponentSchema<Record<string, any>>,
  ) => NovaNode<E>
}

interface NovaRuntimeComponentState extends NovaRuntimeComponentNode {
  props: Record<string, any>
  listeners: NovaComponentListeners
  slots: NovaElementSlots
  setProps: (patch: Record<string, any>) => NovaNode<any>
  setListeners: (listeners?: NovaComponentListeners) => NovaNode<any>
  setSlots: (slots?: NovaElementSlots) => NovaNode<any>
  emit: (name: string, ...args: Array<any>) => void
  [NOVA_RUNTIME_COMPONENT_SYMBOL]?: true
}

/**
 * Декоратор и статический Nova.defineComponent хранят metadata на constructor.
 */
export function defineNovaComponent<E extends EventList, T extends NovaElementConstructor<E>>(
  component: T,
  options: NovaDefinedComponentOptions<E> = {},
): T {
  const existing = readDefinedComponent(component)
  Object.defineProperty(component, NOVA_DEFINED_COMPONENT_SYMBOL, {
    value: {
      ...existing,
      ...options,
    } satisfies NovaDefinedComponentOptions<E>,
    configurable: true,
  })
  return component
}

/**
 * Возвращает metadata class-компонента, если он был помечен define/decorator.
 */
export function readDefinedComponent<E extends EventList = Record<string, any>>(
  component: NovaElementConstructor<E>,
): NovaDefinedComponentOptions<E> | undefined {
  return (component as { [NOVA_DEFINED_COMPONENT_SYMBOL]?: NovaDefinedComponentOptions<E> })[NOVA_DEFINED_COMPONENT_SYMBOL]
}

/**
 * Нормализует class-компонент или explicit definition в единый формат регистрации.
 */
export function normalizeDefinedComponent<E extends EventList = Record<string, any>>(
  input: NovaElementConstructor<E> | NovaDefinedComponentInput<E>,
): NovaNormalizedDefinedComponent<E> {
  if (typeof input === 'function') {
    const metadata = readDefinedComponent(input)
    const decorated = readNovaDecoratedComponent(input)
    return {
      component: input,
      tag: decorated?.tag ?? metadata?.tag,
      name: decorated?.name ?? metadata?.name ?? (input.name || 'AnonymousComponent'),
      version: decorated?.version ?? metadata?.version ?? '0.1.0',
      descriptor: decorated ? createNovaDecoratedComponentDescriptor(input) : undefined,
      createNode: metadata?.createNode,
    }
  }

  const metadata = readDefinedComponent(input.component)
  const decorated = readNovaDecoratedComponent(input.component)
  return {
    component: input.component,
    tag: input.tag ?? decorated?.tag ?? metadata?.tag,
    name: input.name ?? decorated?.name ?? metadata?.name ?? (input.component.name || 'AnonymousComponent'),
    version: input.version ?? decorated?.version ?? metadata?.version ?? '0.1.0',
    descriptor: decorated ? createNovaDecoratedComponentDescriptor(input.component) : undefined,
    createNode: input.createNode ?? metadata?.createNode,
  }
}

/**
 * Регистрирует один или несколько class-компонентов в schema registry.
 */
export function registerDefinedComponents<E extends EventList = Record<string, any>>(
  registry: NovaSchemaRegistry,
  inputs: OneOrMany<NovaElementConstructor<E> | NovaDefinedComponentInput<E>>,
): void {
  const list = Array.isArray(inputs) ? inputs : [inputs]
  for (const item of list) {
    registry.registerDefinedComponent(item)
  }
}

/**
 * Инстанцирует direct constructor component с учетом metadata и generic runtime state.
 */
export function createDefinedComponentNode<E extends EventList = Record<string, any>>(
  component: NovaElementConstructor<E>,
  context: NovaComponentCreateContext<E>,
  options: {
    schema?: NovaComponentSchema<Record<string, any>>
    componentId?: string
    listeners?: NovaComponentListeners
    slots?: NovaElementSlots
  } = {},
): NovaNode<E> {
  const schema = options.schema ?? {
    type: component.name,
    id: options.componentId,
    props: {},
  }
  const metadata = readDefinedComponent(component)
  const Component = component
  const node = metadata?.createNode
    ? metadata.createNode(context, schema)
    : metadata
      ? new Component(context.app, context.surface)
      : new Component(
          context.app,
          context.surface,
          schema.props ?? {},
          options.listeners ?? {},
          options.slots ?? {},
        )

  if (context.context !== undefined) {
    node.setContext(context.context)
  }

  attachRuntimeComponentState(node, {
    componentId: options.componentId ?? schema.id,
    props: schema.props ?? {},
    listeners: options.listeners ?? {},
    slots: options.slots ?? {},
  })

  return node
}

/**
 * Добавляет plain NovaNode минимальный component runtime layer: props, listeners и component id.
 */
export function attachRuntimeComponentState(
  node: NovaNode<any>,
  options: {
    componentId?: string
    props?: Record<string, any>
    listeners?: NovaComponentListeners
    slots?: NovaElementSlots
  } = {},
): void {
  if (node instanceof NovaComponentNode) {
    return
  }

  const target = node as NovaNode<any> & Partial<NovaRuntimeComponentState>
  target.props = {
    ...(target.props ?? {}),
    ...(options.props ?? {}),
  }
  target.listeners = {
    ...(target.listeners ?? {}),
    ...(options.listeners ?? {}),
  }
  target.slots = {
    ...(target.slots ?? {}),
    ...(options.slots ?? {}),
  }

  if (typeof target.emit !== 'function') {
    target.emit = function emit(name: string, ...args: Array<any>): void {
      this.listeners?.[name]?.(...args)
    }
  }

  if (typeof target.getApi !== 'function') {
    target.getApi = function getApi(): unknown {
      return this
    }
  }

  if (typeof target.setListeners !== 'function') {
    target.setListeners = function setListeners(listeners: NovaComponentListeners = {}): NovaNode<any> {
      this.listeners = { ...listeners }
      return this as NovaNode<any>
    }
  }

  if (typeof target.setSlots !== 'function') {
    target.setSlots = function setSlots(slots: NovaElementSlots = {}): NovaNode<any> {
      this.slots = { ...slots }
      ;(this as NovaNode<any>).dirty({ update: true, render: true })
      return this as NovaNode<any>
    }
  }

  if (typeof target.setProps !== 'function') {
    target.setProps = function setProps(patch: Record<string, any>): NovaNode<any> {
      let changed = false
      const next = { ...(this.props ?? {}) }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || next[key] === value) {
          continue
        }
        next[key] = value
        changed = true
      }
      if (changed) {
        this.props = next
        ;(this as NovaNode<any>).dirty({ update: true, render: true })
      }
      return this as NovaNode<any>
    }
  }

  if (!options.componentId) {
    return
  }

  target.componentId = options.componentId

  if (target[NOVA_RUNTIME_COMPONENT_SYMBOL]) {
    return
  }

  node.nova.components.register(target as NovaRuntimeComponentNode)
  node.addDisposer(() => {
    node.nova.components.unregister(target as NovaRuntimeComponentNode)
  })
  target[NOVA_RUNTIME_COMPONENT_SYMBOL] = true
}

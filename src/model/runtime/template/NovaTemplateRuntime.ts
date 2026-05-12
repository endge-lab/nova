import type { EventList } from '@endge/utils'
import type {
  NovaComponentSchema,
  NovaElementSchema,
  NovaElementSlotFactory,
  NovaElementSlots,
  NovaElementType,
} from '@/domain/types/component.types'
import type { NovaNodeEventHandlers } from '@/domain/types/events.types'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import {
  createDefinedComponentNode,
  readDefinedComponent,
} from '@/model/runtime/components/NovaDefinedComponent'

/** Constructor скомпилированного `.nova` компонента. */
export type NovaCompiledNodeConstructor<E extends EventList = Record<string, any>> = new (
  app: NovaApp<E>,
  surface: NovaSurface<E>,
  props?: Record<string, any>,
  listeners?: Record<string, (...args: Array<any>) => void>,
  slots?: NovaTemplateSlots,
) => NovaNode<E>

/** Тип компонента в compiled template schema. */
export type NovaTemplateComponentType<E extends EventList = Record<string, any>> = NovaElementType<E>

/** Фабрика compiled slot, которая возвращает schema snapshot по публичному scope. */
export type NovaTemplateSlotFactory<TScope = Record<string, any>> = NovaElementSlotFactory<TScope>

/** Набор named slots в compiled template schema. */
export type NovaTemplateSlots = NovaElementSlots

export interface NovaTemplateChildSchema<TProps = Record<string, any>>
  extends Omit<NovaElementSchema<TProps>, 'type'> {
  type: NovaTemplateComponentType
  key?: string | number
  context?: unknown
  children?: Array<NovaTemplateChildSchema>
  events?: Partial<NovaNodeEventHandlers>
  slots?: NovaTemplateSlots
}

export interface NovaTemplateReconcileResult<E extends EventList = Record<string, any>> {
  nodes: Array<NovaNode<E>>
  created: number
  reused: number
  removed: number
  patched: number
}

interface NovaTemplateEventState {
  events: Map<string, (...args: Array<any>) => void>
}

interface NovaTemplateListenerTarget {
  setListeners: (listeners: Record<string, (...args: Array<any>) => void>) => void
}

interface NovaTemplateSlotTarget {
  setSlots: (slots: NovaTemplateSlots) => void
}

const NODE_EVENT_STATE = new WeakMap<NovaNode<any>, NovaTemplateEventState>()
const NODE_TEMPLATE_KEY = new WeakMap<NovaNode<any>, string>()

/**
 * Runtime для сгенерированных Nova SFC, который сохраняет identity keyed children.
 */
export class NovaTemplateRuntime<E extends EventList = Record<string, any>> {
  private managedChildren: Array<NovaNode<E>> = []
  private stats: NovaTemplateReconcileResult<E> = {
    nodes: [],
    created: 0,
    reused: 0,
    removed: 0,
    patched: 0,
  }
  private reconciling = false

  /**
   * Создает runtime для конкретного generated root node.
   */
  constructor(private readonly parent: NovaNode<E>) {}

  /**
   * Применяет новый template snapshot к managed children.
   */
  reconcile(children: Array<NovaTemplateChildSchema>): NovaTemplateReconcileResult<E> {
    if (this.reconciling) {
      return this.stats
    }

    this.reconciling = true
    try {
      this.stats = reconcileNovaTemplateChildren(this.parent, this.managedChildren, children)
      this.managedChildren = this.stats.nodes
    } finally {
      this.reconciling = false
    }

    return this.stats
  }

  /**
   * Возвращает последние counters reconcile-прохода.
   */
  getStats(): Readonly<NovaTemplateReconcileResult<E>> {
    return this.stats
  }

  /**
   * Удаляет все managed children.
   */
  dispose(): void {
    for (const child of this.managedChildren) child.remove()
    this.managedChildren = []
    this.reconciling = false
    this.stats = {
      nodes: [],
      created: 0,
      reused: 0,
      removed: 0,
      patched: 0,
    }
  }
}

/**
 * Сверяет children по key/id/type и обновляет существующие component nodes без пересоздания.
 */
export function reconcileNovaTemplateChildren<E extends EventList>(
  parent: NovaNode<E>,
  previousNodes: ReadonlyArray<NovaNode<E>>,
  nextSchemas: ReadonlyArray<NovaTemplateChildSchema>,
): NovaTemplateReconcileResult<E> {
  const available = new Map<string, NovaNode<E>>()
  const used = new Set<NovaNode<E>>()
  const nextNodes: Array<NovaNode<E>> = []
  let created = 0
  let reused = 0
  let removed = 0
  let patched = 0

  previousNodes.forEach((node, index) => {
    available.set(resolveNodeKey(node, index), node)
  })

  nextSchemas.forEach((schema, index) => {
    const key = resolveSchemaKey(schema, index)
    const existing = available.get(key)
    if (existing && canPatchTemplateNode(existing, schema)) {
      patchNovaTemplateNode(existing, schema)
      used.add(existing)
      nextNodes.push(existing)
      reused += 1
      patched += 1
      return
    }

    if (existing) {
      existing.remove()
      used.add(existing)
      removed += 1
    }

    const node = createTemplateChild(parent, schema, key)
    patchNovaTemplateNode(node, schema)
    used.add(node)
    nextNodes.push(node)
    created += 1
  })

  for (const node of previousNodes) {
    if (used.has(node)) continue
    node.remove()
    removed += 1
  }

  reorderManagedChildren(parent, previousNodes, nextNodes)
  parent.dirty({ render: true })

  return {
    nodes: nextNodes,
    created,
    reused,
    removed,
    patched,
  }
}

/**
 * Обновляет props, события, context и вложенные children существующей node.
 */
export function patchNovaTemplateNode<E extends EventList>(
  node: NovaNode<E>,
  schema: NovaTemplateChildSchema,
): void {
  if (Object.prototype.hasOwnProperty.call(schema, 'context')) {
    node.setContext(schema.context)
  }

  if (schema.props && typeof (node as NovaComponentNode<any>).setProps === 'function') {
    ;(node as NovaComponentNode<any>).setProps(schema.props)
  }

  const listenerTarget = node as unknown as Partial<NovaTemplateListenerTarget>
  if (typeof listenerTarget.setListeners === 'function') {
    listenerTarget.setListeners(
      schema.events as Record<string, (...args: Array<any>) => void> ?? {},
    )
  } else {
    patchNovaTemplateEvents(node, schema.events ?? {})
  }

  if (schema.children) {
    const api = typeof (node as NovaComponentNode<any>).getApi === 'function'
      ? (node as NovaComponentNode<any>).getApi() as { setChildren?: (children: Array<NovaTemplateChildSchema>) => void }
      : null
    if (typeof api?.setChildren === 'function') {
      api.setChildren(schema.children)
    }
  }

  const slots = schema.slots ?? {}
  const slotTarget = node as unknown as Partial<NovaTemplateSlotTarget>
  if (typeof slotTarget.setSlots === 'function') {
    slotTarget.setSlots(slots)
  } else if (typeof (node as NovaComponentNode<any>).getApi === 'function') {
    const api = (node as NovaComponentNode<any>).getApi() as Partial<NovaTemplateSlotTarget>
    if (typeof api?.setSlots === 'function') api.setSlots(slots)
  }
}

/**
 * Проверяет, может ли node быть обновлена без пересоздания.
 */
export function canPatchTemplateNode(node: NovaNode<any>, schema: NovaTemplateChildSchema): boolean {
  if (typeof schema.type === 'function') return node.constructor === schema.type

  const component = node as NovaComponentNode<any>
  return !!component.descriptor && component.descriptor.type === schema.type
}

function patchNovaTemplateEvents<E extends EventList>(
  node: NovaNode<E>,
  events: Partial<NovaNodeEventHandlers>,
): void {
  let state = NODE_EVENT_STATE.get(node)
  if (!state) {
    state = { events: new Map() }
    NODE_EVENT_STATE.set(node, state)
  }

  for (const key of [...state.events.keys()]) {
    if (events[key as keyof NovaNodeEventHandlers]) continue
    node.off(key as keyof NovaNodeEventHandlers)
    state.events.delete(key)
  }

  for (const [key, handler] of Object.entries(events)) {
    if (!handler || state.events.get(key) === handler) continue
    if (state.events.has(key)) node.off(key as keyof NovaNodeEventHandlers)
    node.on(key as keyof NovaNodeEventHandlers, handler as NonNullable<NovaNodeEventHandlers[keyof NovaNodeEventHandlers]>)
    state.events.set(key, handler as (...args: Array<any>) => void)
  }
}

function resolveSchemaKey(schema: NovaTemplateChildSchema, index: number): string {
  return String(schema.key ?? schema.id ?? `${resolveSchemaTypeName(schema.type)}:${index}`)
}

function resolveNodeKey(node: NovaNode<any>, index: number): string {
  const templateKey = NODE_TEMPLATE_KEY.get(node)
  if (templateKey) return templateKey

  const component = node as NovaComponentNode<any>
  return String(component.componentId ?? `${node.__type}:${index}`)
}

function createTemplateChild<E extends EventList>(
  parent: NovaNode<E>,
  schema: NovaTemplateChildSchema,
  key: string,
): NovaNode<E> {
  if (typeof schema.type !== 'function') {
    const node = parent.nova.schema.createChild(parent, schema as NovaElementSchema, {
      context: schema.context,
    }) as NovaNode<E>
    NODE_TEMPLATE_KEY.set(node, key)
    return node
  }

  const Component = schema.type as NovaCompiledNodeConstructor<E>
  const node = readDefinedComponent(Component)
    ? createDefinedComponentNode(Component, {
      app: parent.nova,
      surface: parent.surface,
      registry: parent.nova.schema,
      parent,
      context: schema.context,
    }, {
      schema: {
        ...schema,
        type: Component.name || 'AnonymousComponent',
      } as NovaComponentSchema<Record<string, any>>,
      componentId: schema.id,
      listeners: schema.events as Record<string, (...args: Array<any>) => void> ?? {},
      slots: schema.slots ?? {},
    })
    : new Component(
      parent.nova,
      parent.surface,
      schema.props ?? {},
      schema.events as Record<string, (...args: Array<any>) => void> ?? {},
      schema.slots ?? {},
    )
  parent.addChild(node, {
    context: schema.context,
  })
  NODE_TEMPLATE_KEY.set(node, key)
  return node
}

function resolveSchemaTypeName(type: NovaTemplateComponentType): string {
  return typeof type === 'string' ? type : type.name
}

function reorderManagedChildren<E extends EventList>(
  parent: NovaNode<E>,
  previousNodes: ReadonlyArray<NovaNode<E>>,
  nextNodes: ReadonlyArray<NovaNode<E>>,
): void {
  const children = parent.children as Array<NovaNode<E>>
  const managed = new Set([...previousNodes, ...nextNodes])
  const unmanaged = children.filter(child => !managed.has(child))
  children.length = 0
  children.push(...unmanaged, ...nextNodes)
}

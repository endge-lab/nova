import type { EventList } from '@endge/utils'
import type { NovaComponentSchema } from '@/domain/types/component.types'
import type { NovaNodeEventHandlers } from '@/domain/types/events.types'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'

export interface NovaTemplateChildSchema<TProps = Record<string, any>>
  extends NovaComponentSchema<TProps> {
  key?: string | number
  context?: unknown
  children?: NovaTemplateChildSchema[]
  events?: Partial<NovaNodeEventHandlers>
}

export interface NovaTemplateReconcileResult<E extends EventList = Record<string, any>> {
  nodes: NovaNode<E>[]
  created: number
  reused: number
  removed: number
  patched: number
}

interface NovaTemplateEventState {
  events: Map<string, (...args: any[]) => void>
}

const NODE_EVENT_STATE = new WeakMap<NovaNode<any>, NovaTemplateEventState>()

/**
 * Runtime для сгенерированных Nova SFC, который сохраняет identity keyed children.
 */
export class NovaTemplateRuntime<E extends EventList = Record<string, any>> {
  private managedChildren: NovaNode<E>[] = []
  private stats: NovaTemplateReconcileResult<E> = {
    nodes: [],
    created: 0,
    reused: 0,
    removed: 0,
    patched: 0,
  }

  /**
   * Создает runtime для конкретного generated root node.
   */
  constructor(private readonly parent: NovaNode<E>) {}

  /**
   * Применяет новый template snapshot к managed children.
   */
  reconcile(children: NovaTemplateChildSchema[]): NovaTemplateReconcileResult<E> {
    this.stats = reconcileNovaTemplateChildren(this.parent, this.managedChildren, children)
    this.managedChildren = this.stats.nodes
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
  previousNodes: readonly NovaNode<E>[],
  nextSchemas: readonly NovaTemplateChildSchema[],
): NovaTemplateReconcileResult<E> {
  const available = new Map<string, NovaNode<E>>()
  const used = new Set<NovaNode<E>>()
  const nextNodes: NovaNode<E>[] = []
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
      removed += 1
    }

    const node = parent.nova.schema.createChild(parent, schema, {
      context: schema.context,
    }) as NovaNode<E>
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
  parent.dirty({ update: true, render: true })

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

  patchNovaTemplateEvents(node, schema.events ?? {})

  if (schema.children) {
    const api = typeof (node as NovaComponentNode<any>).getApi === 'function'
      ? (node as NovaComponentNode<any>).getApi() as { setChildren?: (children: NovaTemplateChildSchema[]) => void }
      : null
    if (typeof api?.setChildren === 'function') {
      api.setChildren(schema.children)
    }
  }
}

/**
 * Проверяет, может ли node быть обновлена без пересоздания.
 */
export function canPatchTemplateNode(node: NovaNode<any>, schema: NovaTemplateChildSchema): boolean {
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
    state.events.set(key, handler as (...args: any[]) => void)
  }
}

function resolveSchemaKey(schema: NovaTemplateChildSchema, index: number): string {
  return String(schema.key ?? schema.id ?? `${schema.type}:${index}`)
}

function resolveNodeKey(node: NovaNode<any>, index: number): string {
  const component = node as NovaComponentNode<any>
  return String(component.componentId ?? `${node.__type}:${index}`)
}

function reorderManagedChildren<E extends EventList>(
  parent: NovaNode<E>,
  previousNodes: readonly NovaNode<E>[],
  nextNodes: readonly NovaNode<E>[],
): void {
  const children = parent.children as NovaNode<E>[]
  const managed = new Set([...previousNodes, ...nextNodes])
  const unmanaged = children.filter(child => !managed.has(child))
  children.length = 0
  children.push(...unmanaged, ...nextNodes)
}

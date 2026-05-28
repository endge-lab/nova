import type { EventList } from '@endge/utils'
import type {
  NovaComponentApiDefinition,
  NovaComponentCommandDefinition,
  NovaComponentDescriptor,
  NovaComponentDirtyPolicy,
  NovaComponentPropDefinition,
  NovaComponentPropKind,
  NovaComponentSchema,
  NovaComponentWatchDefinition,
  NovaElementConstructor,
} from '@/domain/types/component.types'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'

const NOVA_COMPONENT_METADATA = Symbol('nova.component.metadata')

/**
 * Описывает class-level metadata декорированного компонента.
 */
export interface NovaDecoratedComponentMetadata {
  type?: string
  tag?: string
  name?: string
  version?: string
  dirtyPolicy?: NovaComponentDirtyPolicy<Record<string, any>>
  bounds?: 'size' | 'custom'
  props: Array<NovaComponentPropDefinition>
  watchers: Array<NovaComponentWatchDefinition>
  commands: Array<NovaComponentCommandDefinition>
  apis: Array<NovaComponentApiDefinition>
}

/**
 * Описывает options декоратора NovaComponent.
 */
export interface NovaDecoratedComponentOptions {
  type?: string
  tag?: string
  name?: string
  version?: string
  dirtyPolicy?: NovaComponentDirtyPolicy<Record<string, any>>
  bounds?: 'size' | 'custom'
}

/**
 * Описывает options декоратора Prop.
 */
export interface NovaPropDecoratorOptions<T = unknown> {
  key?: string
  required?: boolean
  default?: T | (() => T)
  defaultValue?: T | (() => T)
  mode?: 'plain' | 'versioned'
}

/**
 * Описывает options декоратора Watch.
 */
export interface NovaWatchDecoratorOptions {
  phase?: 'update' | 'render' | 'matrix'
  immediate?: boolean
}

/**
 * Возвращает metadata конструктора.
 */
export function readNovaDecoratedComponent(
  component: NovaElementConstructor<any>,
): NovaDecoratedComponentMetadata | undefined {
  return (component as unknown as { [NOVA_COMPONENT_METADATA]?: NovaDecoratedComponentMetadata })[NOVA_COMPONENT_METADATA]
}

/**
 * Обновляет metadata конструктора.
 */
export function updateNovaDecoratedComponent(
  component: Function,
  patch: Partial<NovaDecoratedComponentMetadata>,
): NovaDecoratedComponentMetadata {
  const current = readOwnMetadata(component)
  const next: NovaDecoratedComponentMetadata = {
    ...current,
    ...patch,
    props: patch.props ?? current.props,
    watchers: patch.watchers ?? current.watchers,
    commands: patch.commands ?? current.commands,
    apis: patch.apis ?? current.apis,
  }
  Object.defineProperty(component, NOVA_COMPONENT_METADATA, {
    value: next,
    configurable: true,
  })
  return next
}

/**
 * Добавляет prop metadata.
 */
export function addNovaPropMetadata(
  target: object,
  propertyKey: string | symbol,
  kind: NovaComponentPropKind,
  options: NovaPropDecoratorOptions = {},
  event = false,
): void {
  const component = target.constructor
  const metadata = readOwnMetadata(component)
  const key = options.key ?? String(propertyKey)
  const props = metadata.props.filter(prop => prop.key !== key)
  props.push({
    key,
    propertyKey: String(propertyKey),
    kind,
    required: options.required,
    defaultValue: options.defaultValue ?? options.default,
    mode: options.mode,
    event,
  })
  updateNovaDecoratedComponent(component, { props })
}

/**
 * Добавляет watcher metadata.
 */
export function addNovaWatchMetadata(
  target: object,
  propertyKey: string | symbol,
  path: string,
  options: NovaWatchDecoratorOptions = {},
): void {
  const component = target.constructor
  const metadata = readOwnMetadata(component)
  const methodName = String(propertyKey)
  const watchers = metadata.watchers.filter(item => item.methodName !== methodName || item.path !== path)
  watchers.push({
    path,
    methodName,
    phase: options.phase ?? 'update',
    immediate: options.immediate,
  })
  updateNovaDecoratedComponent(component, { watchers })
}

/**
 * Добавляет command metadata.
 */
export function addNovaCommandMetadata(
  target: object,
  propertyKey: string | symbol,
  id: string,
  options: { scope?: string } = {},
): void {
  const component = target.constructor
  const metadata = readOwnMetadata(component)
  const methodName = String(propertyKey)
  const commands = metadata.commands.filter(item => item.methodName !== methodName || item.id !== id)
  commands.push({ id, methodName, scope: options.scope })
  updateNovaDecoratedComponent(component, { commands })
}

/**
 * Добавляет API metadata.
 */
export function addNovaApiMetadata(target: object, propertyKey: string | symbol): void {
  const component = target.constructor
  const metadata = readOwnMetadata(component)
  const methodName = String(propertyKey)
  const apis = metadata.apis.filter(item => item.methodName !== methodName)
  apis.push({ methodName })
  updateNovaDecoratedComponent(component, { apis })
}

/**
 * Создает descriptor из class decorator metadata.
 */
export function createNovaDecoratedComponentDescriptor<
  TProps extends Record<string, any> = Record<string, any>,
  TApi = unknown,
  TEvents extends Record<string, unknown> = Record<string, unknown>,
  TSchema = TProps,
>(
  component: NovaElementConstructor<any>,
): NovaComponentDescriptor<TProps, TApi, TEvents, TSchema> {
  const metadata = collectMetadata(component)
  const type = metadata.type ?? (metadata.tag ? `nova.component:${metadata.tag}` : component.name)
  const descriptor: NovaComponentDescriptor<TProps, TApi, TEvents, TSchema> = {
    type,
    name: metadata.name ?? component.name,
    version: metadata.version ?? '0.1.0',
    kind: 'node-component',
    dirtyPolicy: metadata.dirtyPolicy as NovaComponentDirtyPolicy<TProps>,
    propDefinitions: metadata.props,
    watchDefinitions: metadata.watchers,
    commandDefinitions: metadata.commands,
    apiDefinitions: metadata.apis,
    bounds: resolveBounds(metadata),
    fields: createFields(metadata.props),
    normalize: schema => normalizeDecoratedProps(schema, metadata) as TProps,
    measureBounds: (_ctx, schema) => {
      if (resolveBounds(metadata) !== 'size') return null
      const props = normalizeDecoratedProps(schema, metadata)
      return {
        x: 0,
        y: 0,
        width: Number(props.width ?? 0),
        height: Number(props.height ?? 0),
      }
    },
    createNode: (context, schema) => createDecoratedNode(component, descriptor, context, schema),
  }
  return descriptor
}

/**
 * Устанавливает accessors для prop-полей на prototype.
 */
export function installNovaPropAccessors(component: Function): void {
  const metadata = collectMetadata(component)
  for (const prop of metadata.props) {
    const accessorKey = prop.propertyKey ?? prop.key
    const descriptor = Object.getOwnPropertyDescriptor(component.prototype, accessorKey)
    if (descriptor?.get || descriptor?.set) continue
    Object.defineProperty(component.prototype, accessorKey, {
      get(this: { props?: Record<string, any>; getProps?: () => Record<string, any> }) {
        return typeof this.getProps === 'function' ? this.getProps()[prop.key] : this.props?.[prop.key]
      },
      set(this: { props?: Record<string, any>; setProps?: (patch: Record<string, any>) => unknown }, value: unknown) {
        if (typeof this.setProps === 'function') this.setProps({ [prop.key]: value })
        else {
          this.props = { ...(this.props ?? {}), [prop.key]: value }
        }
      },
      configurable: true,
    })
  }
}

/**
 * Возвращает normalized props декорированного компонента.
 */
export function normalizeDecoratedProps(
  schema: NovaComponentSchema<Record<string, any>>,
  metadata: NovaDecoratedComponentMetadata,
): Record<string, any> {
  const input = schema.props ?? {}
  const output: Record<string, any> = {}
  for (const prop of metadata.props) {
    let value = input[prop.key]
    if (value === undefined) value = resolveDefaultValue(prop)
    if (value === undefined && prop.required) {
      throw new Error(`[NovaComponent] Required prop "${prop.key}" is missing.`)
    }
    if (prop.kind === 'options' && prop.mode === 'versioned') {
      value = normalizeVersionedOptions(value)
    }
    output[prop.key] = value
  }

  for (const [key, value] of Object.entries(input)) {
    if (!(key in output)) output[key] = value
  }
  return output
}

/**
 * Считывает значение path из object.
 */
export function readNovaComponentPath(source: Record<string, any> | undefined, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = source
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Собирает metadata с учетом prototype chain.
 */
export function collectMetadata(component: Function): NovaDecoratedComponentMetadata {
  const chain: Array<NovaDecoratedComponentMetadata> = []
  let current: unknown = component
  while (typeof current === 'function') {
    const metadata = readNovaDecoratedComponent(current as NovaElementConstructor<any>)
    if (metadata) chain.unshift(metadata)
    current = Object.getPrototypeOf(current)
  }

  return chain.reduce<NovaDecoratedComponentMetadata>((acc, item) => ({
    type: item.type ?? acc.type,
    tag: item.tag ?? acc.tag,
    name: item.name ?? acc.name,
    version: item.version ?? acc.version,
    dirtyPolicy: item.dirtyPolicy ?? acc.dirtyPolicy,
    bounds: item.bounds ?? acc.bounds,
    props: mergeByKey(acc.props, item.props),
    watchers: [...acc.watchers, ...item.watchers],
    commands: [...acc.commands, ...item.commands],
    apis: [...acc.apis, ...item.apis],
  }), createEmptyMetadata())
}

/**
 * Возвращает пустую metadata.
 */
function createEmptyMetadata(): NovaDecoratedComponentMetadata {
  return {
    props: [],
    watchers: [],
    commands: [],
    apis: [],
  }
}

/**
 * Возвращает own metadata конструктора.
 */
function readOwnMetadata(component: Function): NovaDecoratedComponentMetadata {
  const current = (component as { [NOVA_COMPONENT_METADATA]?: NovaDecoratedComponentMetadata })[NOVA_COMPONENT_METADATA]
  if (!current) return createEmptyMetadata()
  return {
    ...current,
    props: [...current.props],
    watchers: [...current.watchers],
    commands: [...current.commands],
    apis: [...current.apis],
  }
}

/**
 * Создает fields из prop metadata.
 */
function createFields(props: Array<NovaComponentPropDefinition>): Record<string, { type: string; required?: boolean }> {
  const fields: Record<string, { type: string; required?: boolean }> = {}
  for (const prop of props) {
    fields[prop.key] = {
      type: prop.kind === 'model' ? 'record' : prop.kind,
      required: prop.required,
    }
  }
  return fields
}

/**
 * Создает decorated node.
 */
function createDecoratedNode<E extends EventList>(
  component: NovaElementConstructor<E>,
  descriptor: NovaComponentDescriptor<any, any, any, any>,
  context: { app: any; surface: any },
  schema: NovaComponentSchema<Record<string, any>>,
): NovaNode<E> {
  const props = descriptor.normalize?.(schema) ?? schema.props ?? {}
  if (component.prototype instanceof NovaComponentNode) {
    return new (component as any)(context.app, context.surface, descriptor, props, { componentId: schema.id })
  }
  const node = new component(context.app, context.surface, props)
  attachPlainDecoratedRuntime(node, props, schema.id)
  return node
}

/**
 * Добавляет plain NovaNode минимальный runtime layer для decorated descriptor.
 */
function attachPlainDecoratedRuntime(node: NovaNode<any>, props: Record<string, any>, componentId?: string): void {
  const target = node as NovaNode<any> & {
    props?: Record<string, any>
    componentId?: string
    getApi?: () => unknown
    setProps?: (patch: Record<string, any>) => NovaNode<any>
  }
  target.props = { ...(target.props ?? {}), ...props }
  if (typeof target.getApi !== 'function') target.getApi = () => target
  if (componentId) {
    target.componentId = componentId
    node.nova.components.register(target as { componentId: string; getApi: () => unknown })
    node.addDisposer(() => node.nova.components.unregister(target as { componentId: string; getApi: () => unknown }))
  }
  if (typeof target.setProps !== 'function') {
    target.setProps = patch => {
      target.props = { ...(target.props ?? {}), ...patch }
      node.dirty({ update: true, render: true })
      return node
    }
  }
}

/**
 * Возвращает bounds mode.
 */
function resolveBounds(metadata: NovaDecoratedComponentMetadata): 'size' | 'custom' {
  if (metadata.bounds) return metadata.bounds
  const hasWidth = metadata.props.some(prop => prop.key === 'width')
  const hasHeight = metadata.props.some(prop => prop.key === 'height')
  return hasWidth && hasHeight ? 'size' : 'custom'
}

/**
 * Возвращает default prop value.
 */
function resolveDefaultValue(prop: NovaComponentPropDefinition): unknown {
  if (typeof prop.defaultValue === 'function') return (prop.defaultValue as () => unknown)()
  return prop.defaultValue
}

/**
 * Нормализует versioned options ref.
 */
function normalizeVersionedOptions(value: unknown): { current: unknown; version: number } {
  if (value && typeof value === 'object' && 'current' in value) {
    const ref = value as { current: unknown; version?: number }
    return { current: ref.current, version: ref.version ?? 0 }
  }
  return { current: value, version: 0 }
}

/**
 * Мержит definitions по key.
 */
function mergeByKey<T extends { key: string }>(base: Array<T>, patch: Array<T>): Array<T> {
  const map = new Map<string, T>()
  for (const item of base) map.set(item.key, item)
  for (const item of patch) map.set(item.key, item)
  return [...map.values()]
}

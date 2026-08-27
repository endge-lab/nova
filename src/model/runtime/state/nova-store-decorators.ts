import type { NovaPhaseName } from '@/domain/constants/nova-phase'

export type NovaStorePhase = 'update' | 'matrix' | 'render'
export type NovaStorePhaseInput = NovaStorePhase | Array<NovaStorePhase>

export interface NovaReactiveOptions<TStore extends object = object> {
  path?: string | ((store: TStore) => string)
  phase?: NovaStorePhaseInput
}

export interface NovaStoreOptions {
  scope?: string
}

export interface NovaReactiveFieldMetadata {
  key: string | symbol
  options: NovaReactiveOptions
}

export interface NovaStoreMetadata {
  reactiveFields: Array<NovaReactiveFieldMetadata>
}

const NOVA_STORE_METADATA = Symbol('nova.store.metadata')

type NovaStoreConstructor = abstract new (...args: Array<any>) => object

/**
 * Помечает class как business store, поля которого могут быть привязаны к Raph data graph.
 */
export function Store(options: NovaStoreOptions = {}) {
  return <T extends new (...args: Array<any>) => object>(target: T): T => {
    updateNovaStoreMetadata(target, metadata => ({
      ...metadata,
      options,
    }) as NovaStoreMetadata & { options?: NovaStoreOptions })
    return target
  }
}

/**
 * Помечает поле store как reactive data path.
 */
export function Reactive<TStore extends object = object>(options: NovaReactiveOptions<TStore> = {}) {
  return (...args: Array<any>): any => {
    if (isStandardAccessorDecorator(args)) {
      const [value, context] = args as [
        { get: (this: object) => unknown, set: (this: object, value: unknown) => void },
        { kind: string, name: string | symbol, addInitializer?: (initializer: (this: object) => void) => void },
      ]
      context.addInitializer?.(function initializer(this: object) {
        addNovaReactiveMetadata(novaStoreConstructorOf(this), context.name, options as NovaReactiveOptions)
      })
      return value
    }

    const [target, propertyKey] = args as [object, string | symbol, PropertyDescriptor | undefined]
    addNovaReactiveMetadata(novaStoreConstructorOf(target), propertyKey, options as NovaReactiveOptions)
    return args[2]
  }
}

/**
 * Возвращает store metadata конструктора.
 */
export function readNovaStoreMetadata(target: NovaStoreConstructor): NovaStoreMetadata | undefined {
  return (target as any)[NOVA_STORE_METADATA] as NovaStoreMetadata | undefined
}

/**
 * Проверяет, что объект помечен как Nova store или содержит reactive fields.
 */
export function isNovaStoreObject(value: unknown): value is object {
  if (!value || typeof value !== 'object') {
    return false
  }
  const metadata = readNovaStoreMetadata(value.constructor as NovaStoreConstructor)
  return Boolean(metadata?.reactiveFields.length)
}

/**
 * Возвращает store options конструктора.
 */
export function readNovaStoreOptions(target: NovaStoreConstructor): NovaStoreOptions {
  return ((target as any)[NOVA_STORE_METADATA]?.options ?? {}) as NovaStoreOptions
}

function addNovaReactiveMetadata(
  target: NovaStoreConstructor,
  key: string | symbol,
  options: NovaReactiveOptions,
): void {
  updateNovaStoreMetadata(target, (metadata) => {
    const reactiveFields = metadata.reactiveFields.filter(field => field.key !== key)
    reactiveFields.push({ key, options })
    return { ...metadata, reactiveFields }
  })
}

function updateNovaStoreMetadata(
  target: NovaStoreConstructor,
  update: (metadata: NovaStoreMetadata) => NovaStoreMetadata,
): void {
  const previous = readNovaStoreMetadata(target) ?? { reactiveFields: [] }
  ;(target as any)[NOVA_STORE_METADATA] = update(previous)
}

function novaStoreConstructorOf(target: object): NovaStoreConstructor {
  return target.constructor as NovaStoreConstructor
}

function isStandardAccessorDecorator(args: Array<any>): boolean {
  return args.length === 2
    && args[1]
    && typeof args[1] === 'object'
    && 'kind' in args[1]
    && args[1].kind === 'accessor'
}

export function normalizeNovaStorePhases(input?: NovaStorePhaseInput, fallback?: NovaPhaseName | string): Array<NovaStorePhase> {
  const source = input ?? fallback ?? 'update'
  const phases = Array.isArray(source) ? source : [source]
  return phases
    .filter((phase): phase is NovaStorePhase => phase === 'update' || phase === 'matrix' || phase === 'render')
}

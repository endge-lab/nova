type NovaRefResolver<T extends object> = (api: T) => void

interface NovaRefState<T extends object> {
  name?: string
  api: T | null
  readyResolvers: Array<NovaRefResolver<T>>
  methodCache: Map<PropertyKey, (...args: Array<any>) => unknown>
}

interface NovaRefMapState<T extends object> {
  refs: Map<string, NovaRef<T>>
}

const NOVA_REF_STATE = new WeakMap<object, NovaRefState<any>>()
const NOVA_REF_MAP_STATE = new WeakMap<object, NovaRefMapState<any>>()
const VUE_REACTIVITY_FLAGS = new Set<PropertyKey>([
  '__v_isRef',
  '__v_isReadonly',
  '__v_isReactive',
  '__v_isShallow',
  '__v_raw',
])

/**
 * Proxy-ref на публичный API Nova component без `.current`.
 */
export type NovaRef<T extends object> = T & {
  readonly $mounted: boolean
  $ready(): Promise<T>
}

/**
 * Коллекция refs для компонентов, созданных внутри repeat/list.
 */
export interface NovaRefMap<T extends object> {
  get(key: string | number): NovaRef<T>
  has(key: string | number): boolean
  delete(key: string | number): boolean
  keys(): IterableIterator<string>
  values(): IterableIterator<NovaRef<T>>
  entries(): IterableIterator<[string, NovaRef<T>]>
  readonly size: number
}

/**
 * Scope refs, который передается template runtime.
 */
export interface NovaScope {
  refs: Record<string, NovaRef<any> | NovaRefMap<any>>
}

/**
 * Создает пустой scope refs.
 */
export function createNovaScope(input: Partial<NovaScope> = {}): NovaScope {
  return {
    refs: input.refs ?? {},
  }
}

/**
 * Создает proxy-ref для component API.
 */
export function createNovaRef<T extends object>(name?: string): NovaRef<T> {
  const state: NovaRefState<T> = {
    name,
    api: null,
    readyResolvers: [],
    methodCache: new Map(),
  }

  const proxy = new Proxy({}, {
    get(_target, property) {
      if (VUE_REACTIVITY_FLAGS.has(property)) return false
      if (property === Symbol.toStringTag) return 'NovaRef'
      if (property === '$mounted') return state.api !== null
      if (property === '$ready') {
        return () => {
          if (state.api) return Promise.resolve(state.api)
          return new Promise<T>(resolve => state.readyResolvers.push(resolve))
        }
      }

      const cached = state.methodCache.get(property)
      if (cached) return cached

      const api = requireNovaRefApi(state)
      const value = (api as Record<PropertyKey, unknown>)[property]
      if (typeof value !== 'function') return value

      const method = (...args: Array<any>) => {
        const current = requireNovaRefApi(state)
        return ((current as Record<PropertyKey, unknown>)[property] as (...methodArgs: Array<any>) => unknown)
          .apply(current, args)
      }
      state.methodCache.set(property, method)
      return method
    },

    set(_target, property, value) {
      const api = requireNovaRefApi(state)
      ;(api as Record<PropertyKey, unknown>)[property] = value
      return true
    },

    has(_target, property) {
      if (VUE_REACTIVITY_FLAGS.has(property)) return false
      if (property === '$mounted' || property === '$ready') return true
      return state.api !== null && property in state.api
    },
  }) as NovaRef<T>

  NOVA_REF_STATE.set(proxy, state)
  return proxy
}

/**
 * Создает map refs для keyed template nodes.
 */
export function createNovaRefMap<T extends object>(): NovaRefMap<T> {
  const state: NovaRefMapState<T> = {
    refs: new Map(),
  }

  const refMap: NovaRefMap<T> = {
    get(key: string | number): NovaRef<T> {
      const normalized = String(key)
      let ref = state.refs.get(normalized)
      if (!ref) {
        ref = createNovaRef<T>(normalized)
        state.refs.set(normalized, ref)
      }
      return ref
    },
    has(key: string | number): boolean {
      return state.refs.has(String(key))
    },
    delete(key: string | number): boolean {
      return state.refs.delete(String(key))
    },
    keys(): IterableIterator<string> {
      return state.refs.keys()
    },
    values(): IterableIterator<NovaRef<T>> {
      return state.refs.values()
    },
    entries(): IterableIterator<[string, NovaRef<T>]> {
      return state.refs.entries()
    },
    get size(): number {
      return state.refs.size
    },
  }

  NOVA_REF_MAP_STATE.set(refMap, state)
  return refMap
}

/**
 * Проверяет, является ли value обычным NovaRef.
 */
export function isNovaRef(value: unknown): value is NovaRef<any> {
  return typeof value === 'object' && value !== null && NOVA_REF_STATE.has(value)
}

/**
 * Проверяет, является ли value NovaRefMap.
 */
export function isNovaRefMap(value: unknown): value is NovaRefMap<any> {
  return typeof value === 'object' && value !== null && NOVA_REF_MAP_STATE.has(value)
}

/**
 * Привязывает API к ref.
 */
export function bindNovaRef<T extends object>(ref: NovaRef<T>, api: T): void {
  const state = readNovaRefState(ref)
  if (state.api && state.api !== api) {
    throw new Error(`[NovaRef] Ref "${resolveNovaRefName(state)}" is already mounted.`)
  }

  state.api = api
  const resolvers = state.readyResolvers.splice(0)
  for (const resolve of resolvers) resolve(api)
}

/**
 * Отвязывает API от ref.
 */
export function unbindNovaRef<T extends object>(ref: NovaRef<T>, api?: T): void {
  const state = readNovaRefState(ref)
  if (api && state.api !== api) return
  state.api = null
}

/**
 * Привязывает API к ref map entry.
 */
export function bindNovaRefMap<T extends object>(refMap: NovaRefMap<T>, key: string | number, api: T): void {
  bindNovaRef(refMap.get(key), api)
}

/**
 * Отвязывает API от ref map entry.
 */
export function unbindNovaRefMap<T extends object>(refMap: NovaRefMap<T>, key: string | number, api?: T): void {
  const ref = refMap.get(key)
  unbindNovaRef(ref, api)
}

function readNovaRefState<T extends object>(ref: NovaRef<T>): NovaRefState<T> {
  const state = NOVA_REF_STATE.get(ref)
  if (!state) {
    throw new Error('[NovaRef] Invalid Nova ref.')
  }
  return state
}

function requireNovaRefApi<T extends object>(state: NovaRefState<T>): T {
  if (!state.api) {
    throw new Error(`[NovaRef] Ref "${resolveNovaRefName(state)}" is not mounted.`)
  }
  return state.api
}

function resolveNovaRefName(state: NovaRefState<any>): string {
  return state.name ?? 'anonymous'
}

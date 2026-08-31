import type { DataPathDef } from '@endge/raph'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaReactiveFieldMetadata, NovaStoreConstructor, NovaStorePhase } from '@/model/runtime/state/nova-store-decorators'
import {
  isNovaStoreObject,
  normalizeNovaStorePhases,

  readNovaStoreMetadata,
  readNovaStoreOptions,
} from '@/model/runtime/state/nova-store-decorators'
import { trackNovaStoreRead } from '@/model/runtime/state/nova-store-tracking'

export interface NovaCreateStoreOptions {
  app?: NovaApp<any>
  scope?: string
}

export interface NovaStoreRuntime {
  app?: NovaApp<any>
  scope: string
  path: string
  root: object
}

const STORE_RUNTIME = new WeakMap<object, NovaStoreRuntime>()

/**
 * Создает reactive business store и подключает его к Raph data graph.
 */
export function createNovaStore<T extends object>(instance: T, options: NovaCreateStoreOptions = {}): T {
  const configuredScope = options.scope ?? readNovaStoreOptions(instance.constructor as NovaStoreConstructor).scope
  const scope = configuredScope ?? `store:${instance.constructor.name || 'anonymous'}:${nextStoreId()}`
  attachNovaStore(instance, {
    app: options.app,
    scope,
    path: '',
    root: instance,
  })
  return instance
}

/**
 * Выполняет несколько store mutations в одной Raph transaction.
 */
export function batchNovaStore<T>(store: object, callback: () => T): T {
  const runtime = findNovaStoreRuntime(store)
  if (!runtime?.app) {
    return callback()
  }
  let result!: T
  runtime.app.raph.kernel.transaction(() => {
    result = callback()
  })
  return result
}

/**
 * Возвращает runtime metadata store instance.
 */
export function findNovaStoreRuntime(store: object): NovaStoreRuntime | undefined {
  return STORE_RUNTIME.get(store)
}

let storeId = 0

function nextStoreId(): number {
  storeId += 1
  return storeId
}

function attachNovaStore(store: object, runtime: NovaStoreRuntime): void {
  const previousRuntime = STORE_RUNTIME.get(store)
  if (previousRuntime) {
    previousRuntime.app = runtime.app
    previousRuntime.scope = runtime.scope
    previousRuntime.path = runtime.path
    previousRuntime.root = runtime.root
    runtime = previousRuntime
  }
  else {
    STORE_RUNTIME.set(store, runtime)
  }
  const metadata = readNovaStoreMetadata(store.constructor as NovaStoreConstructor)
  if (!metadata) {
    return
  }

  for (const field of metadata.reactiveFields) {
    installReactiveField(store, runtime, field)
  }
}

function installReactiveField(
  store: object,
  runtime: NovaStoreRuntime,
  field: NovaReactiveFieldMetadata,
): void {
  const key = field.key
  const descriptor = Object.getOwnPropertyDescriptor(store, key)
  if (descriptor?.get && descriptor?.set) {
    const value = (store as any)[key]
    if (isNovaStoreObject(value)) {
      attachNovaStore(value, {
        ...runtime,
        path: resolveFieldPath(store, runtime.path, field),
      })
    }
    else {
      writeInitialValue(runtime, resolveFieldPath(store, runtime.path, field), value)
    }
    return
  }

  let value = (store as any)[key]
  const localPath = resolveFieldPath(store, runtime.path, field)
  const childRuntime: NovaStoreRuntime = {
    ...runtime,
    path: localPath,
  }
  if (isNovaStoreObject(value)) {
    attachNovaStore(value, childRuntime)
  }
  else { writeInitialValue(runtime, localPath, value) }

  Object.defineProperty(store, key, {
    configurable: true,
    enumerable: true,
    get() {
      if (isNovaStoreObject(value)) {
        trackNovaStoreRead(createStorePath(runtime, `${localPath}.*`), field.options.phase)
      }
      else {
        trackNovaStoreRead(createStorePath(runtime, localPath), field.options.phase)
      }
      return value
    },
    set(next: unknown) {
      if (Object.is(value, next)) {
        return
      }
      value = next
      const branch = isNovaStoreObject(next)
      if (branch) {
        attachNovaStore(next, childRuntime)
        notifyOnly(runtime, `${localPath}.*`)
        return
      }
      notifyPath(runtime, localPath, next, normalizeNovaStorePhases(field.options.phase))
    },
  })
}

function resolveFieldPath(
  store: object,
  parentPath: string,
  field: NovaReactiveFieldMetadata,
): string {
  const explicit = field.options.path
  const local = typeof explicit === 'function'
    ? explicit(store)
    : explicit ?? String(field.key)
  return parentPath ? `${parentPath}.${local}` : local
}

function createStorePath(runtime: NovaStoreRuntime, path: string): DataPathDef {
  return runtime.scope ? `${runtime.scope}.${path}` : path
}

function writeInitialValue(runtime: NovaStoreRuntime, path: string, value: unknown): void {
  runtime.app?.raph.kernel.set(createStorePath(runtime, path), value, { invalidate: false })
}

function notifyPath(
  runtime: NovaStoreRuntime,
  path: string,
  value: unknown,
  _phases: Array<NovaStorePhase>,
): void {
  if (!runtime.app) {
    return
  }
  runtime.app.raph.kernel.set(createStorePath(runtime, path), value)
}

function notifyOnly(runtime: NovaStoreRuntime, path: string): void {
  runtime.app?.raph.kernel.notify(createStorePath(runtime, path))
}

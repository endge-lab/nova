import type { EventList } from '@endge/utils'
import type { NovaComponentDescriptor } from '@/domain/types/component.types'
import type { NovaMotionOptions, NovaMotionPlayback } from '@/domain/types/motion.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaSyncPortMap } from '@/model/runtime/sync/nova-sync.types'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import {
  readNovaComponentPath,
} from '@/model/runtime/components/nova-component-metadata'
import { createNovaComponentPropSyncPorts } from '@/model/runtime/sync/nova-sync-ports'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает runtime-сущность NovaComponentNode.
 */
export abstract class NovaComponentNode<
  TProps extends Record<string, any> = Record<string, any>,
  TApi = unknown,
  TEvents extends Record<string, unknown> = Record<string, unknown>,
  TSchema = TProps,
  E extends EventList = Record<string, any>,
> extends NovaNode<E> {
  //
  // Внутреннее состояние graph runtime и lifecycle.
  readonly descriptor: NovaComponentDescriptor<TProps, TApi, TEvents, TSchema>
  readonly componentId: string

  protected props: TProps
  private _unregisterSyncPorts?: () => void
  private _commandDisposers: Array<() => void> = []
  private _pendingWatcherChanges = new Map<string, { prev: unknown, next: unknown }>()

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    app: NovaApp<E>,
    surface: NovaSurface<E>,
    descriptor: NovaComponentDescriptor<TProps, TApi, TEvents, TSchema>,
    props: TProps,
    options: { componentId?: string } = {},
  ) {
    super(app, surface)

    this.descriptor = descriptor
    this.componentId = options.componentId ?? `${descriptor.type}:${this.id}`
    this.props = { ...props }
    this.__type = descriptor.name
    this.nova.components.register(this)
  }

  /**
   * Обновляет props.
   */
  setProps(patch: Partial<TProps>): this {
    const changedKeys: Array<keyof TProps> = []
    const previousWatcherValues = this._readWatcherValues()

    for (const key of Object.keys(patch) as Array<keyof TProps>) {
      const nextValue = patch[key]
      if (nextValue === undefined || this.props[key] === nextValue) {
        continue
      }
      this.props[key] = nextValue as TProps[typeof key]
      changedKeys.push(key)
    }

    if (changedKeys.length === 0) {
      return this
    }

    this.onPropsChanged(changedKeys)
    this._collectWatcherChanges(previousWatcherValues)
    this.dirty(this._resolveDirty(changedKeys))
    this._notifySyncPortsChanged(changedKeys)
    return this
  }

  /**
   * Возвращает props.
   */
  getProps(): Readonly<TProps> {
    return this.props
  }

  /**
   * Возвращает api.
   */
  getApi(): TApi {
    if (this.descriptor.apiDefinitions?.length) {
      const api: Record<string, unknown> = {}
      for (const item of this.descriptor.apiDefinitions) {
        const method = (this as unknown as Record<string, unknown>)[item.methodName]
        if (typeof method === 'function') {
          api[item.methodName] = method.bind(this)
        }
      }
      return api as TApi
    }
    return this as unknown as TApi
  }

  /**
   * Выполняет внутреннюю операцию dispose.
   */
  override dispose(): void {
    this._unregisterSyncPorts?.()
    this._unregisterSyncPorts = undefined
    this.nova.components.unregister(this)
    super.dispose()
  }

  /**
   * Возвращает sync-порты runtime component. По умолчанию descriptor fields
   * становятся безопасными prop-портами.
   */
  getSyncPorts(): NovaSyncPortMap {
    return createNovaComponentPropSyncPorts(this as never)
  }

  /**
   * Регистрирует component ports в app-level sync scope после mount.
   */
  protected override onMount(): void {
    super.onMount()
    this._unregisterSyncPorts = this.nova.sync.registerNode(this, this.getSyncPorts())
    this._registerCommands()
    this._runImmediateWatchers()
  }

  /**
   * Снимает component ports при unmount.
   */
  protected override onUnmount(): void {
    this._disposeCommands()
    this._unregisterSyncPorts?.()
    this._unregisterSyncPorts = undefined
    super.onUnmount()
  }

  /**
   * Выполняет watchers update-фазы перед пользовательским update.
   */
  override update(): void {
    this._runWatchers('update')
  }

  /**
   * Выполняет watchers render-фазы перед пользовательским render.
   */
  override render(): void {
    this._runWatchers('render')
  }

  /**
   * Уведомляет sync scope об изменении конкретного порта.
   */
  notifySyncPortChanged(name: string, value?: unknown): void {
    if (arguments.length >= 2) {
      this.nova.sync.notifyPortChanged(this, name, value)
    }
    else { this.nova.sync.notifyPortChanged(this, name) }
  }

  /**
   * Обрабатывает событие props changed.
   */
  protected onPropsChanged(_changedKeys: Array<keyof TProps>): void {}

  /**
   * Выполняет внутренний шаг notifySyncPortsChanged для NovaComponentNode.
   */
  private _notifySyncPortsChanged(changedKeys: Array<keyof TProps>): void {
    for (const key of changedKeys) {
      this.notifySyncPortChanged(String(key), this.props[key])
    }
  }

  /**
   * Выполняет внутреннюю операцию transition to.
   */
  protected transitionTo(patch: Partial<TProps>, options?: NovaMotionOptions): NovaMotionPlayback {
    return this.nova.motion.to(this, patch as Record<string, any>, options)
  }

  /**
   * Вычисляет dirty.
   */
  private _resolveDirty(changedKeys: Array<keyof TProps>): { matrix?: boolean, update?: boolean, render?: boolean } {
    const policy = this.descriptor.dirtyPolicy
    if (!policy) {
      return { update: true, render: true }
    }

    const hasMatrix = intersectsDirtyPaths(changedKeys, policy.matrix, this._pendingWatcherChanges)
    const hasUpdate = intersectsDirtyPaths(changedKeys, policy.update, this._pendingWatcherChanges)
    const hasRender = hasUpdate || hasMatrix || intersectsDirtyPaths(changedKeys, policy.render, this._pendingWatcherChanges)
      || dirtyPathsChanged(policy.render, this._pendingWatcherChanges)

    if (!hasMatrix && !hasUpdate && !hasRender) {
      return { update: true, render: true }
    }
    return {
      matrix: hasMatrix,
      update: hasUpdate,
      render: hasRender,
    }
  }

  /**
   * Читает watched paths перед изменением props.
   */
  private _readWatcherValues(): Map<string, unknown> {
    const values = new Map<string, unknown>()
    for (const watcher of this.descriptor.watchDefinitions ?? []) {
      values.set(watcher.path, readNovaComponentPath(this.props, watcher.path))
    }
    for (const path of collectDirtyPolicyPaths(this.descriptor.dirtyPolicy)) {
      values.set(path, readNovaComponentPath(this.props, path))
    }
    return values
  }

  /**
   * Собирает changed watched paths после изменения props.
   */
  private _collectWatcherChanges(previous: Map<string, unknown>): void {
    this._pendingWatcherChanges.clear()
    for (const [path, prev] of previous) {
      const next = readNovaComponentPath(this.props, path)
      if (Object.is(prev, next)) {
        continue
      }
      this._pendingWatcherChanges.set(path, { prev, next })
    }
  }

  /**
   * Выполняет immediate watchers.
   */
  private _runImmediateWatchers(): void {
    for (const watcher of this.descriptor.watchDefinitions ?? []) {
      const next = readNovaComponentPath(this.props, watcher.path)
      if (!watcher.immediate) {
        continue
      }
      this._callWatcher(watcher.methodName, {
        next,
        prev: undefined,
        path: watcher.path,
        changedPaths: [watcher.path],
      })
    }
  }

  /**
   * Выполняет watchers указанной фазы.
   */
  private _runWatchers(phase: 'update' | 'render' | 'matrix'): void {
    const watchers = (this.descriptor.watchDefinitions ?? []).filter(watcher => watcher.phase === phase)
    if (watchers.length === 0) {
      return
    }

    for (const watcher of watchers) {
      const change = this._pendingWatcherChanges.get(watcher.path)
      if (!change) {
        continue
      }
      this._callWatcher(watcher.methodName, {
        next: change.next,
        prev: change.prev,
        path: watcher.path,
        changedPaths: [...this._pendingWatcherChanges.keys()],
      })
    }
  }

  /**
   * Вызывает watcher method.
   */
  private _callWatcher(methodName: string, payload: { next: unknown, prev: unknown, path: string, changedPaths: Array<string> }): void {
    const method = (this as unknown as Record<string, unknown>)[methodName]
    if (typeof method === 'function') {
      method.call(this, payload.next, payload.prev, payload)
    }
  }

  /**
   * Регистрирует command handlers.
   */
  private _registerCommands(): void {
    this._disposeCommands()
    for (const command of this.descriptor.commandDefinitions ?? []) {
      const method = (this as unknown as Record<string, unknown>)[command.methodName]
      if (typeof method !== 'function') {
        continue
      }
      this._commandDisposers.push(this.nova.commands.register(command.id, payload => method.call(this, payload), {
        owner: this,
        scope: command.scope,
      }))
    }
  }

  /**
   * Снимает command handlers.
   */
  private _disposeCommands(): void {
    for (const dispose of this._commandDisposers.splice(0)) {
      dispose()
    }
  }
}

/**
 * Выполняет внутреннюю операцию intersects.
 */
/**
 * Проверяет dirty paths по top-level keys и cached path changes.
 */
function intersectsDirtyPaths<TProps extends Record<string, any>>(
  changedKeys: ReadonlyArray<keyof TProps>,
  policyKeys: ReadonlyArray<keyof TProps | string> | undefined,
  changes: Map<string, { prev: unknown, next: unknown }>,
): boolean {
  if (!policyKeys?.length) {
    return false
  }
  return policyKeys.some((path) => {
    const stringPath = String(path)
    if (stringPath.includes('.')) {
      return changes.has(stringPath)
    }
    return changedKeys.includes(stringPath as keyof TProps)
  })
}

/**
 * Проверяет, изменились ли string paths dirty policy.
 */
function dirtyPathsChanged<TProps extends Record<string, any>>(
  policyKeys: ReadonlyArray<keyof TProps | string> | undefined,
  changes: Map<string, { prev: unknown, next: unknown }>,
): boolean {
  if (!policyKeys?.length) {
    return false
  }
  return policyKeys.some(path => changes.has(String(path)))
}

/**
 * Собирает paths из dirty policy.
 */
function collectDirtyPolicyPaths<TProps extends Record<string, any>>(
  policy?: { update?: ReadonlyArray<keyof TProps | string>, render?: ReadonlyArray<keyof TProps | string>, matrix?: ReadonlyArray<keyof TProps | string> },
): Array<string> {
  if (!policy) {
    return []
  }
  return [...(policy.update ?? []), ...(policy.render ?? []), ...(policy.matrix ?? [])]
    .map(String)
    .filter(path => path.includes('.'))
}

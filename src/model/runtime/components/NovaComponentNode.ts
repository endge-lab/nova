import type { EventList } from '@endge/utils'
import { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import type { NovaComponentDescriptor } from '@/domain/types/component.types'
import type { NovaMotionOptions, NovaMotionPlayback } from '@/domain/types/motion.types'
import { createNovaComponentPropSyncPorts } from '@/model/runtime/sync/nova-sync-ports'
import type { NovaSyncPortMap } from '@/model/runtime/sync/nova-sync.types'

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
  private unregisterSyncPorts?: () => void

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

    for (const key of Object.keys(patch) as Array<keyof TProps>) {
      const nextValue = patch[key]
      if (nextValue === undefined || this.props[key] === nextValue) continue
      this.props[key] = nextValue as TProps[typeof key]
      changedKeys.push(key)
    }

    if (changedKeys.length === 0) return this

    this.onPropsChanged(changedKeys)
    this.dirty(this.resolveDirty(changedKeys))
    this.notifySyncPortsChanged(changedKeys)
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
    return this as unknown as TApi
  }

  /**
   * Выполняет внутреннюю операцию dispose.
   */
  override dispose(): void {
    this.unregisterSyncPorts?.()
    this.unregisterSyncPorts = undefined
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
    this.unregisterSyncPorts = this.nova.sync.registerNode(this, this.getSyncPorts())
  }

  /**
   * Снимает component ports при unmount.
   */
  protected override onUnmount(): void {
    this.unregisterSyncPorts?.()
    this.unregisterSyncPorts = undefined
    super.onUnmount()
  }

  /**
   * Уведомляет sync scope об изменении конкретного порта.
   */
  notifySyncPortChanged(name: string, value?: unknown): void {
    if (arguments.length >= 2) this.nova.sync.notifyPortChanged(this, name, value)
    else this.nova.sync.notifyPortChanged(this, name)
  }

  /**
   * Обрабатывает событие props changed.
   */
  protected onPropsChanged(_changedKeys: Array<keyof TProps>): void {}

  private notifySyncPortsChanged(changedKeys: Array<keyof TProps>): void {
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
  private resolveDirty(changedKeys: Array<keyof TProps>): { matrix?: boolean; update?: boolean; render?: boolean } {
    const policy = this.descriptor.dirtyPolicy
    if (!policy) return { update: true, render: true }

    const hasMatrix = intersects(changedKeys, policy.matrix)
    const hasUpdate = intersects(changedKeys, policy.update)
    const hasRender = hasUpdate || hasMatrix || intersects(changedKeys, policy.render)

    if (!hasMatrix && !hasUpdate && !hasRender) return { update: true, render: true }
    return {
      matrix: hasMatrix,
      update: hasUpdate,
      render: hasRender,
    }
  }
}

/**
 * Выполняет внутреннюю операцию intersects.
 */
function intersects<T>(changedKeys: ReadonlyArray<T>, policyKeys?: ReadonlyArray<T>): boolean {
  if (!policyKeys?.length) return false
  return changedKeys.some(key => policyKeys.includes(key))
}

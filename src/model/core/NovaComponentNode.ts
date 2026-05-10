import { NovaNode } from '@/model/core/NovaNode'
import type { NovaApp } from '@/model/app/NovaApp'
import type { NovaSurface } from '@/model/core/NovaSurface'
import type { NovaComponentDescriptor } from '@/domain/types/component-types'
import type { EventList } from '@endge/utils'
import type { NovaMotionOptions, NovaMotionPlayback } from '@/domain/types/motion-types'

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
    const changedKeys: (keyof TProps)[] = []

    for (const key of Object.keys(patch) as (keyof TProps)[]) {
      const nextValue = patch[key]
      if (nextValue === undefined || this.props[key] === nextValue) continue
      this.props[key] = nextValue as TProps[typeof key]
      changedKeys.push(key)
    }

    if (changedKeys.length === 0) return this

    this.onPropsChanged(changedKeys)
    this.dirty(this.resolveDirty(changedKeys))
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
    this.nova.components.unregister(this)
    super.dispose()
  }

  /**
   * Обрабатывает событие props changed.
   */
  protected onPropsChanged(_changedKeys: (keyof TProps)[]): void {}

  /**
   * Выполняет внутреннюю операцию transition to.
   */
  protected transitionTo(patch: Partial<TProps>, options?: NovaMotionOptions): NovaMotionPlayback {
    return this.nova.motion.to(this, patch as Record<string, any>, options)
  }

  /**
   * Вычисляет dirty.
   */
  private resolveDirty(changedKeys: (keyof TProps)[]): { matrix?: boolean; update?: boolean; render?: boolean } {
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
function intersects<T>(changedKeys: readonly T[], policyKeys?: readonly T[]): boolean {
  if (!policyKeys?.length) return false
  return changedKeys.some(key => policyKeys.includes(key))
}

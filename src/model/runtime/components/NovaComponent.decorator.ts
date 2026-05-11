import type { EventList } from '@endge/utils'
import type { NovaElementConstructor } from '@/domain/types/component.types'
import {
  defineNovaComponent,
  type NovaDefinedComponentOptions,
} from '@/model/runtime/components/NovaDefinedComponent'

/**
 * Помечает class-компонент metadata для DSL и явной registry-регистрации.
 */
export function NovaComponent<E extends EventList = Record<string, any>>(
  options: NovaDefinedComponentOptions<E> = {},
) {
  return <T extends NovaElementConstructor<E>>(target: T): T => defineNovaComponent(target, options)
}

import type { DataPathDef, RaphObserveDataOptions, Traversal } from '@endge/raph'
import type { NovaPhaseName } from '@/domain/constants/NovaPhase'

/**
 * Описывает типизированный token scoped dependency в Nova tree.
 */
export type NovaContextToken<T> = symbol & {
  readonly __novaContextType?: T
}

/**
 * Описывает параметры явного контекста child-ноды.
 */
export interface NovaNodeContextOptions {
  context?: unknown
}

/**
 * Описывает параметры добавления child-ноды.
 */
export interface NovaAddChildOptions extends NovaNodeContextOptions {
  invalidate?: boolean
}

/**
 * Описывает параметры подписки Nova-ноды на business data path.
 */
export interface NovaObserveDataOptions extends Omit<RaphObserveDataOptions, 'phase' | 'traversal'> {
  phase?: NovaPhaseName | string
  traversal?: Traversal
}

/**
 * Описывает публичную сигнатуру подписки Nova-ноды на business data path.
 */
export type NovaObserveData = (
  path: DataPathDef,
  options?: NovaObserveDataOptions,
) => () => void

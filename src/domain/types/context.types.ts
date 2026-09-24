import type { DataPathDef } from '@raphy-js/raph/path'
import type { NovaPhaseName } from '@/domain/constants/nova-phase'

// Описывает типизированный token scoped dependency в Nova tree.
export type NovaContextToken<T> = symbol & {
  readonly __novaContextType?: T
}

// Описывает параметры явного контекста child-ноды.
export interface NovaNodeContextOptions {
  context?: unknown
}

// Описывает параметры добавления child-ноды.
export interface NovaAddChildOptions extends NovaNodeContextOptions {
  invalidate?: boolean
}

// Описывает параметры подписки Nova-ноды на business data path.
export interface NovaObserveDataOptions {
  phase?: NovaPhaseName | string
  traversal?: 'dirty-only' | 'dirty-and-down' | 'dirty-and-up' | 'all'
  vars?: Record<string, unknown>
  wildcardDynamic?: boolean
}

// Описывает публичную сигнатуру подписки Nova-ноды на business data path.
export type NovaObserveData = (
  path: DataPathDef,
  options?: NovaObserveDataOptions,
) => () => void

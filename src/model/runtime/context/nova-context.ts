import type { NovaContextToken } from '@/domain/types/context.types'

/**
 * Создает типизированный token для scoped dependency в Nova tree.
 */
export function createNovaContextToken<T>(name: string): NovaContextToken<T> {
  return Symbol(name) as NovaContextToken<T>
}

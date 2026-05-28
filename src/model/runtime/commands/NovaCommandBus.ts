import type { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает обработчик Nova command.
 */
export type NovaCommandHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => TResult

/**
 * Описывает target команды.
 */
export type NovaCommandTarget = NovaNode<any> | { componentId?: string } | string

/**
 * Описывает параметры регистрации команды.
 */
export interface NovaCommandRegisterOptions {
  owner?: NovaCommandTarget
  scope?: string
}

/**
 * Описывает параметры запуска команды.
 */
export interface NovaCommandRunOptions {
  target?: NovaCommandTarget
  scope?: string
}

interface NovaCommandEntry {
  id: string
  handler: NovaCommandHandler<any, any>
  owner?: NovaCommandTarget
  scope?: string
  order: number
}

/**
 * Хранит Nova commands и разрешает scoped/targeted запуск.
 */
export class NovaCommandBus {
  private readonly entries = new Map<string, Array<NovaCommandEntry>>()
  private order = 0

  /**
   * Регистрирует command handler.
   */
  register<TPayload = unknown, TResult = unknown>(
    id: string,
    handler: NovaCommandHandler<TPayload, TResult>,
    options: NovaCommandRegisterOptions = {},
  ): () => void {
    const entry: NovaCommandEntry = {
      id,
      handler,
      owner: options.owner,
      scope: options.scope,
      order: this.order++,
    }
    const list = this.entries.get(id) ?? []
    list.push(entry)
    this.entries.set(id, list)

    return () => {
      const current = this.entries.get(id)
      if (!current) return
      const next = current.filter(item => item !== entry)
      if (next.length === 0) this.entries.delete(id)
      else this.entries.set(id, next)
    }
  }

  /**
   * Запускает command handler.
   */
  run<TPayload = unknown, TResult = unknown>(
    id: string,
    payload?: TPayload,
    options: NovaCommandRunOptions = {},
  ): TResult {
    const entry = this.resolveEntry(id, options)
    return entry.handler(payload) as TResult
  }

  /**
   * Возвращает количество handlers для команды.
   */
  count(id?: string): number {
    if (id) return this.entries.get(id)?.length ?? 0
    let total = 0
    for (const list of this.entries.values()) total += list.length
    return total
  }

  /**
   * Выбирает единственный handler для запуска.
   */
  private resolveEntry(id: string, options: NovaCommandRunOptions): NovaCommandEntry {
    let list = [...(this.entries.get(id) ?? [])]
    if (options.scope) list = list.filter(entry => entry.scope === options.scope)
    const target = options.target
    if (target !== undefined) list = list.filter(entry => commandTargetMatches(entry.owner, target))

    if (list.length === 0) {
      throw new Error(`[NovaCommandBus] Command "${id}" is not registered.`)
    }
    if (list.length > 1 && !options.target && !options.scope) {
      throw new Error(`[NovaCommandBus] Command "${id}" has ${list.length} handlers. Pass target or scope.`)
    }

    return list.sort((a, b) => b.order - a.order)[0]
  }
}

/**
 * Проверяет совпадение command target.
 */
function commandTargetMatches(owner: NovaCommandTarget | undefined, target: NovaCommandTarget): boolean {
  if (owner === target) return true
  if (typeof owner === 'string' || typeof target === 'string') {
    return resolveCommandTargetId(owner) === resolveCommandTargetId(target)
  }
  return resolveCommandTargetId(owner) === resolveCommandTargetId(target)
}

/**
 * Возвращает стабильный id command target.
 */
function resolveCommandTargetId(target: NovaCommandTarget | undefined): string | undefined {
  if (target === undefined) return undefined
  if (typeof target === 'string') return target
  return (target as { componentId?: string }).componentId
}

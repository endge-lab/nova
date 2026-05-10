import type { NovaApp } from '@/model/runtime/app/NovaApp'
import { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaLifecycleState } from '@/domain/types/renderer.types'
import type { EventList } from '@endge/utils'

/**
 * Описывает монтируемую сцену Nova и управляет ее жизненным циклом.
 */
export class NovaScene<E extends EventList> {
  private readonly _roots = new Set<NovaNode<E>>()
  private _state: NovaLifecycleState = 'created'

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(protected readonly app: NovaApp<E>) {}

  /**
   * Выполняет внутреннюю операцию mount.
   */
  mount(): void {
    if (this._state === 'destroyed') {
      throw new Error('Нельзя смонтировать уничтоженную Nova-сцену')
    }
    if (this._state === 'mounted') return

    this._state = 'mounted'
    this.onMount()

    for (const root of this._roots) {
      root.mountSubtree()
    }

    this.app.invalidate()
  }

  /**
   * Выполняет внутреннюю операцию pause.
   */
  pause(): void {
    if (this._state !== 'mounted') return

    this._state = 'paused'
    this.onPause()

    for (const root of this._roots) {
      root.pause()
    }
  }

  /**
   * Выполняет внутреннюю операцию resume.
   */
  resume(): void {
    if (this._state !== 'paused') return

    this._state = 'mounted'
    this.onResume()

    for (const root of this._roots) {
      root.resume()
    }

    this.app.invalidate()
  }

  /**
   * Выполняет внутреннюю операцию unmount.
   */
  unmount(): void {
    if (this._state === 'created' || this._state === 'destroyed') return

    this.onUnmount()

    for (const root of [...this._roots]) {
      root.remove()
    }
    this._roots.clear()

    this._state = 'created'
    this.app.invalidate()
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    if (this._state === 'destroyed') return

    this.unmount()
    this.onDestroy()
    this._state = 'destroyed'
  }

  /**
   * Добавляет root.
   */
  protected addRoot<T extends NovaNode<E>>(root: T): T {
    this._roots.add(root)
    if (this._state === 'mounted' || this._state === 'paused') {
      root.mountSubtree()
    }
    if (this._state === 'paused') {
      root.pause()
    }

    return root
  }

  /**
   * Удаляет root.
   */
  protected removeRoot(root: NovaNode<E>): void {
    if (!this._roots.delete(root)) return

    root.remove()
    this.app.invalidate()
  }

  /**
   * Обрабатывает событие mount.
   */
  protected onMount(): void {}
  /**
   * Обрабатывает событие pause.
   */
  protected onPause(): void {}
  /**
   * Обрабатывает событие resume.
   */
  protected onResume(): void {}
  /**
   * Обрабатывает событие unmount.
   */
  protected onUnmount(): void {}
  /**
   * Обрабатывает событие destroy.
   */
  protected onDestroy(): void {}

  /**
   * Возвращает state.
   */
  get state(): NovaLifecycleState {
    return this._state
  }

  /**
   * Возвращает root count.
   */
  get rootCount(): number {
    return this._roots.size
  }
}

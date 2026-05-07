import type { NovaApp } from '@/domain/entities/app/NovaApp'
import { NovaNode } from '@/domain/entities/core/NovaNode'
import type { NovaLifecycleState } from '@/domain/types/renderer-types'
import type { EventList } from '@endge/utils'

export class NovaScene<E extends EventList> {
  private readonly _roots = new Set<NovaNode<E>>()
  private _state: NovaLifecycleState = 'created'

  constructor(protected readonly app: NovaApp<E>) {}

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

  pause(): void {
    if (this._state !== 'mounted') return

    this._state = 'paused'
    this.onPause()

    for (const root of this._roots) {
      root.pause()
    }
  }

  resume(): void {
    if (this._state !== 'paused') return

    this._state = 'mounted'
    this.onResume()

    for (const root of this._roots) {
      root.resume()
    }

    this.app.invalidate()
  }

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

  destroy(): void {
    if (this._state === 'destroyed') return

    this.unmount()
    this.onDestroy()
    this._state = 'destroyed'
  }

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

  protected removeRoot(root: NovaNode<E>): void {
    if (!this._roots.delete(root)) return

    root.remove()
    this.app.invalidate()
  }

  protected onMount(): void {}
  protected onPause(): void {}
  protected onResume(): void {}
  protected onUnmount(): void {}
  protected onDestroy(): void {}

  get state(): NovaLifecycleState {
    return this._state
  }

  get rootCount(): number {
    return this._roots.size
  }
}

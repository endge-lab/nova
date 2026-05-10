import { NovaNode } from '@/model/core/NovaNode'
import type { NovaApp } from '@/model/app/NovaApp'
import type { NovaSurface } from '@/model/core/NovaSurface'
import type { EventList } from '@endge/utils'
import type { NovaBounds } from '@/domain/types/renderer-types'
import { createEmptyBounds, unionBounds } from '@/domain/utils/bounds'

/**
 * Описывает контейнерный node для группировки дочерних Nova nodes.
 */
export class NovaContainer<E extends EventList> extends NovaNode<E> {
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(app: NovaApp<E>, surface?: NovaSurface<E>) {
    super(app, surface)
  }

  /**
   * Добавляет дочернюю Nova-ноду в контейнер.
   */
  add<T extends NovaNode<E>>(node: T): T {
    this.addChild(node)
    this.dirty({ render: true })

    return node
  }

  /**
   * Добавляет набор дочерних Nova-нод и делает один render-dirty проход.
   */
  addMany<T extends NovaNode<E>>(nodes: Array<T>): Array<T> {
    for (const node of nodes) {
      this.addChild(node, { invalidate: false })
    }

    this.dirty({ render: true })
    return nodes
  }

  /**
   * Удаляет дочернюю Nova-ноду из контейнера и уничтожает ее.
   */
  remove(): void
  /**
   * Выполняет внутреннюю операцию remove.
   */
  remove(node: NovaNode<E>): boolean
  /**
   * Выполняет внутреннюю операцию remove.
   */
  remove(node?: NovaNode<E>): boolean | void {
    if (!node) {
      super.remove()
      return
    }

    if (node.parent !== this) return false

    node.remove()
    this.dirty({ render: true })

    return true
  }

  /**
   * Уничтожает всех дочерних Nova-потомков контейнера.
   */
  clear(): void {
    for (const child of [...this.novaChildren]) {
      child.dispose()
    }

    this.children.length = 0
    this.nova.events.markSpatialDirty()
    this.dirty({ render: true })
  }

  /**
   * Быстро переключает видимость всей группы через состояние контейнера.
   */
  setGroupVisible(visible: boolean): this {
    this.visible = visible
    return this
  }

  /**
   * Выполняет внутреннюю операцию show.
   */
  show(): this {
    return this.setGroupVisible(true)
  }

  /**
   * Выполняет внутреннюю операцию hide.
   */
  hide(): this {
    return this.setGroupVisible(false)
  }

  /**
   * Быстро переключает активность всей группы через состояние контейнера.
   */
  setGroupActive(active: boolean): this {
    this.active = active
    return this
  }

  /**
   * Выполняет внутреннюю операцию activate.
   */
  activate(): this {
    return this.setGroupActive(true)
  }

  /**
   * Выполняет внутреннюю операцию deactivate.
   */
  deactivate(): this {
    return this.setGroupActive(false)
  }

  /**
   * Переключает локальную видимость всех прямых Nova-детей.
   */
  setChildrenVisible(visible: boolean): this {
    for (const child of this.novaChildren) {
      child.visible = visible
    }

    this.dirty({ render: true })
    return this
  }

  /**
   * Переключает локальную активность всех прямых Nova-детей.
   */
  setChildrenActive(active: boolean): this {
    for (const child of this.novaChildren) {
      child.active = active
    }

    return this
  }

  /**
   * Возвращает child count.
   */
  get childCount(): number {
    return this.novaChildren.length
  }

  /**
   * Возвращает local bounds.
   */
  override getLocalBounds(): NovaBounds {
    let bounds = createEmptyBounds()

    for (const child of this.novaChildren) {
      const childBounds = child.getLocalBounds()
      bounds = unionBounds(bounds, {
        x: child.x + childBounds.x,
        y: child.y + childBounds.y,
        width: childBounds.width,
        height: childBounds.height,
      })
    }

    return bounds
  }

  /**
   * Возвращает nova children.
   */
  get novaChildren(): Array<NovaNode<E>> {
    return this.children.filter((child): child is NovaNode<E> => child instanceof NovaNode)
  }
}

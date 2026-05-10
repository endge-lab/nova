import type { NovaComponentNode } from '@/model/core/NovaComponentNode'

/**
 * Хранит node components и schema components, доступные runtime Nova.
 */
export class NovaComponentRegistry {
  private readonly _nodes = new Map<string, NovaComponentNode<any, any, any, any, any>>()

  /**
   * Выполняет внутреннюю операцию register.
   */
  register(node: NovaComponentNode<any, any, any, any, any>): void {
    const existing = this._nodes.get(node.componentId)
    if (existing && existing !== node) {
      throw new Error(`[NovaComponentRegistry] Component id "${node.componentId}" is already registered`)
    }

    this._nodes.set(node.componentId, node)
  }

  /**
   * Выполняет внутреннюю операцию unregister.
   */
  unregister(node: NovaComponentNode<any, any, any, any, any>): void {
    if (this._nodes.get(node.componentId) === node) {
      this._nodes.delete(node.componentId)
    }
  }

  /**
   * Выполняет внутреннюю операцию get.
   */
  get<TNode extends NovaComponentNode<any, any, any, any, any> = NovaComponentNode<any, any, any, any, any>>(
    id: string,
  ): TNode | undefined {
    return this._nodes.get(id) as TNode | undefined
  }

  /**
   * Выполняет внутреннюю операцию require.
   */
  require<TNode extends NovaComponentNode<any, any, any, any, any> = NovaComponentNode<any, any, any, any, any>>(
    id: string,
  ): TNode {
    const node = this.get<TNode>(id)
    if (!node) {
      throw new Error(`[NovaComponentRegistry] Component id "${id}" is not registered`)
    }
    return node
  }

  /**
   * Выполняет внутреннюю операцию api.
   */
  api<TApi>(id: string): TApi | undefined {
    return this.get(id)?.getApi() as TApi | undefined
  }

  /**
   * Выполняет внутреннюю операцию require api.
   */
  requireApi<TApi>(id: string): TApi {
    const api = this.api<TApi>(id)
    if (!api) {
      throw new Error(`[NovaComponentRegistry] Component API for id "${id}" is not registered`)
    }
    return api
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this._nodes.clear()
  }
}


import type { NovaComponentNode } from '@/model/core/NovaComponentNode'

export class NovaComponentRegistry {
  private readonly _nodes = new Map<string, NovaComponentNode<any, any, any, any, any>>()

  register(node: NovaComponentNode<any, any, any, any, any>): void {
    const existing = this._nodes.get(node.componentId)
    if (existing && existing !== node) {
      throw new Error(`[NovaComponentRegistry] Component id "${node.componentId}" is already registered`)
    }

    this._nodes.set(node.componentId, node)
  }

  unregister(node: NovaComponentNode<any, any, any, any, any>): void {
    if (this._nodes.get(node.componentId) === node) {
      this._nodes.delete(node.componentId)
    }
  }

  get<TNode extends NovaComponentNode<any, any, any, any, any> = NovaComponentNode<any, any, any, any, any>>(
    id: string,
  ): TNode | undefined {
    return this._nodes.get(id) as TNode | undefined
  }

  require<TNode extends NovaComponentNode<any, any, any, any, any> = NovaComponentNode<any, any, any, any, any>>(
    id: string,
  ): TNode {
    const node = this.get<TNode>(id)
    if (!node) {
      throw new Error(`[NovaComponentRegistry] Component id "${id}" is not registered`)
    }
    return node
  }

  api<TApi>(id: string): TApi | undefined {
    return this.get(id)?.getApi() as TApi | undefined
  }

  requireApi<TApi>(id: string): TApi {
    const api = this.api<TApi>(id)
    if (!api) {
      throw new Error(`[NovaComponentRegistry] Component API for id "${id}" is not registered`)
    }
    return api
  }

  clear(): void {
    this._nodes.clear()
  }
}


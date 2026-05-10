import type { NovaRenderItem } from '@/domain/types/rendering/index'

/**
 * Описывает контракт NovaWebGLRenderBatch.
 */
export interface NovaWebGLRenderBatch {
  key: string
  items: Array<NovaRenderItem>
}

/**
 * Группирует WebGL render items в batches с учетом painter order и ключей batching.
 */
export class NovaWebGLBatcher {
  /**
   * Выполняет внутреннюю операцию build display order batches.
   */
  buildDisplayOrderBatches(items: Array<NovaRenderItem>): Array<NovaWebGLRenderBatch> {
    const batches: Array<NovaWebGLRenderBatch> = []
    const ordered = [...items].sort((a, b) => a.order - b.order)

    for (const item of ordered) {
      const current = batches.length > 0 ? batches[batches.length - 1] : undefined
      if (current && current.key === item.batchKey) {
        current.items.push(item)
        continue
      }

      batches.push({
        key: item.batchKey,
        items: [item],
      })
    }

    return batches
  }
}

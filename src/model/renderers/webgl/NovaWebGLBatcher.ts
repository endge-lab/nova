import type { NovaRenderItem } from '@/domain/types/rendering/index'

export interface NovaWebGLRenderBatch {
  key: string
  items: NovaRenderItem[]
}

export class NovaWebGLBatcher {
  buildDisplayOrderBatches(items: NovaRenderItem[]): NovaWebGLRenderBatch[] {
    const batches: NovaWebGLRenderBatch[] = []
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

import type { NovaRenderLayer, NovaRenderLayerId } from '@/domain/types/rendering/index'
import { createNovaRenderGroup } from '@/model/rendering/NovaRenderGroup'

export function createNovaRenderLayer(id: NovaRenderLayerId, zIndex = 0): NovaRenderLayer {
  return {
    id,
    zIndex,
    rootGroup: createNovaRenderGroup({
      id: `${id}:root`,
      layerId: id,
    }),
  }
}

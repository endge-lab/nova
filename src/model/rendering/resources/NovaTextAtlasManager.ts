import type { NovaRendererTextConfig } from '@/domain/types/rendering/index'
import type { NovaText } from '@/domain/types/renderer-types'
import { NovaTextLayoutEngine } from '@/model/rendering/resources/NovaTextLayoutEngine'
import { NovaTextureAtlasManager, type NovaTextureAtlasEntry } from '@/model/rendering/resources/NovaTextureAtlasManager'

export interface NovaTextAtlasResolveResult {
  entry: NovaTextureAtlasEntry<NovaText>
  cacheHit: boolean
  bucket: number
  rasterized: boolean
}

export class NovaTextAtlasManager {
  private readonly _atlas: NovaTextureAtlasManager<NovaText>
  private readonly _layout = new NovaTextLayoutEngine()

  constructor(private readonly _config: NovaRendererTextConfig) {
    this._atlas = new NovaTextureAtlasManager<NovaText>({
      maxMemoryMB: _config.maxAtlasMemoryMB,
    })
  }

  get memoryMB(): number {
    return this._atlas.memoryMB
  }

  resolve(text: NovaText, zoom = 1): NovaTextAtlasResolveResult {
    const bucket = this.resolveZoomBucket(zoom)
    const layout = this._layout.measure(text, bucket)
    const key = `${layout.fontKey}:${bucket}:${text.styles?.color ?? '#000'}:${text.text}`
    const current = this._atlas.get(key)
    if (current) {
      return {
        entry: current,
        cacheHit: true,
        bucket,
        rasterized: false,
      }
    }

    const entry = this._atlas.set({
      id: `text:${key}`,
      key,
      width: Math.max(1, layout.width),
      height: Math.max(1, layout.height),
      scale: bucket,
      payload: text,
    })

    return {
      entry,
      cacheHit: false,
      bucket,
      rasterized: true,
    }
  }

  resolveZoomBucket(zoom: number): number {
    const buckets = this._config.zoomBuckets.length > 0 ? this._config.zoomBuckets : [1]
    let best = buckets[0]
    let bestDistance = Math.abs(zoom - best)

    for (const bucket of buckets) {
      const distance = Math.abs(zoom - bucket)
      if (distance < bestDistance) {
        best = bucket
        bestDistance = distance
      }
    }

    return best
  }

  evictToBudget(): void {
    this._atlas.evictToBudget()
  }
}

import type { NovaRendererTextConfig } from '@/domain/types/rendering/index'
import {
  NovaTextureAtlasManager,
  type NovaTextureAtlasEntry,
  type NovaTextureAtlasPage,
} from '@/model/rendering/resources/NovaTextureAtlasManager'

export interface NovaGlyphDescriptor {
  glyph: string
  fontKey: string
  color: string
}

export interface NovaGlyphAtlasResolveResult {
  entry: NovaTextureAtlasEntry<NovaGlyphDescriptor>
  cacheHit: boolean
  bucket: number
}

export class NovaGlyphAtlasManager {
  private readonly _atlas: NovaTextureAtlasManager<NovaGlyphDescriptor>

  constructor(private readonly _config: NovaRendererTextConfig) {
    this._atlas = new NovaTextureAtlasManager<NovaGlyphDescriptor>({
      maxMemoryMB: _config.maxAtlasMemoryMB,
    })
  }

  get memoryMB(): number {
    return this._atlas.memoryMB
  }

  get pages(): NovaTextureAtlasPage[] {
    return this._atlas.pages
  }

  resolve(descriptor: NovaGlyphDescriptor, zoom = 1): NovaGlyphAtlasResolveResult {
    const bucket = this.resolveZoomBucket(zoom)
    const key = `${descriptor.fontKey}:${bucket}:${descriptor.color}:${descriptor.glyph}`
    const current = this._atlas.get(key)
    if (current) {
      return {
        entry: current,
        cacheHit: true,
        bucket,
      }
    }

    const estimatedSize = Math.max(1, Math.ceil(16 * bucket))
    return {
      entry: this._atlas.set({
        id: `glyph:${key}`,
        key,
        width: estimatedSize,
        height: estimatedSize,
        scale: bucket,
        payload: descriptor,
      }),
      cacheHit: false,
      bucket,
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
}

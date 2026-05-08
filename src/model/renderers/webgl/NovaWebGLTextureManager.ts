import { NovaTextureAtlasManager } from '@/model/rendering/resources/NovaTextureAtlasManager'

export class NovaWebGLTextureManager {
  readonly atlas = new NovaTextureAtlasManager<WebGLTexture>({
    maxMemoryMB: 128,
  })

  constructor(readonly gl: WebGLRenderingContext) {}

  destroy(): void {
    for (const entry of this.atlas.entries) {
      if (entry.payload) this.gl.deleteTexture(entry.payload)
    }
    this.atlas.clear()
  }
}

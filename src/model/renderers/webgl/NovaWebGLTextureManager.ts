import { NovaTextureAtlasManager } from '@/model/rendering/resources/NovaTextureAtlasManager'

/**
 * Управляет WebGL textures, atlas resources и texture bindings.
 */
export class NovaWebGLTextureManager {
  readonly atlas = new NovaTextureAtlasManager<WebGLTexture>({
    maxMemoryMB: 128,
  })

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(readonly gl: WebGLRenderingContext) {}

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    for (const entry of this.atlas.entries) {
      if (entry.payload) this.gl.deleteTexture(entry.payload)
    }
    this.atlas.clear()
  }
}

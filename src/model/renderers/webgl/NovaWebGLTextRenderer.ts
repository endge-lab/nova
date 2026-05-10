import type { NovaRendererTextConfig } from '@/domain/types/rendering/index'
import type { NovaText } from '@/domain/types/renderer-types'
import { NovaTextAtlasManager } from '@/model/rendering/resources/NovaTextAtlasManager'

/**
 * Рисует text runs через WebGL texture path.
 */
export class NovaWebGLTextRenderer {
  readonly textAtlas: NovaTextAtlasManager

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(config: NovaRendererTextConfig) {
    this.textAtlas = new NovaTextAtlasManager(config)
  }

  /**
   * Вычисляет text.
   */
  resolveText(text: NovaText, zoom = 1): ReturnType<NovaTextAtlasManager['resolve']> {
    return this.textAtlas.resolve(text, zoom)
  }
}

import type { NovaRendererTextConfig } from '@/domain/types/rendering/index'
import type { NovaText } from '@/domain/types/renderer-types'
import { NovaTextAtlasManager } from '@/model/rendering/resources/NovaTextAtlasManager'

export class NovaWebGLTextRenderer {
  readonly textAtlas: NovaTextAtlasManager

  constructor(config: NovaRendererTextConfig) {
    this.textAtlas = new NovaTextAtlasManager(config)
  }

  resolveText(text: NovaText, zoom = 1): ReturnType<NovaTextAtlasManager['resolve']> {
    return this.textAtlas.resolve(text, zoom)
  }
}

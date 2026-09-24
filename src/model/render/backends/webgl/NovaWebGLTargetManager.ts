import { NovaRenderTargetManager } from '@/model/render/targets/NovaRenderTargetManager'

/**
 * Управляет WebGL render targets поверх общего Nova target manager.
 */
export class NovaWebGLTargetManager extends NovaRenderTargetManager {
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(readonly gl: WebGLRenderingContext) {
    super()
  }
}

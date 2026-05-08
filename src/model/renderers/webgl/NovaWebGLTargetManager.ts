import { NovaRenderTargetManager } from '@/model/rendering/targets/NovaRenderTargetManager'

export class NovaWebGLTargetManager extends NovaRenderTargetManager {
  constructor(readonly gl: WebGLRenderingContext) {
    super()
  }
}

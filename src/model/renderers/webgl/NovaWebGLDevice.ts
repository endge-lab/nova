import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'

export class NovaWebGLDevice {
  readonly gl: WebGLRenderingContext

  constructor(readonly canvas: NovaCanvas) {
    this.gl = canvas.getContextWebGL()
  }

  resize(): void {
    this.gl.viewport(0, 0, this.canvas.pixelWidth, this.canvas.pixelHeight)
  }

  clear(): void {
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }
}

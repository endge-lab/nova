import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'

export class NovaWebGLDevice {
  readonly gl: WebGL2RenderingContext

  constructor(
    readonly canvas: NovaCanvas,
    attributes: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: true,
      stencil: true,
      preserveDrawingBuffer: false,
    },
  ) {
    const gl = canvas.element.getContext('webgl2', attributes)
    if (!gl) {
      throw new Error('Nova RendererType.WebGL requires WebGL2. webgl-old is not used as fallback.')
    }

    this.gl = gl
    this.configure()
  }

  resize(): void {
    this.gl.viewport(0, 0, this.canvas.pixelWidth, this.canvas.pixelHeight)
  }

  clear(): void {
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT | this.gl.STENCIL_BUFFER_BIT)
  }

  private configure(): void {
    const gl = this.gl
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }
}

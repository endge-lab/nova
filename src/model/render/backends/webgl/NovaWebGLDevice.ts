import type { NovaCanvas } from '@/model/infrastructure/canvas/NovaCanvas'

/**
 * Инкапсулирует WebGL2 context и базовые операции frame lifecycle.
 */
export class NovaWebGLDevice {
  readonly gl: WebGL2RenderingContext

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    readonly canvas: NovaCanvas,
    attributes: WebGLContextAttributes = canvas.webglAttributes ?? {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    },
  ) {
    const gl = canvas.element.getContext('webgl2', attributes)
    if (!gl) {
      throw new Error('Nova RendererType.WebGL requires WebGL2.')
    }

    this.gl = gl
    this.configure()
  }

  /**
   * Выполняет внутреннюю операцию resize.
   */
  resize(): void {
    this.gl.viewport(0, 0, this.canvas.pixelWidth, this.canvas.pixelHeight)
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  /**
   * Выполняет внутреннюю операцию configure.
   */
  private configure(): void {
    const gl = this.gl
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }
}

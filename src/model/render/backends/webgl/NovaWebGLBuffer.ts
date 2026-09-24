/**
 * Оборачивает WebGLBuffer и операции загрузки данных в GPU.
 */
export class NovaWebGLBuffer {
  readonly buffer: WebGLBuffer

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(private readonly _gl: WebGLRenderingContext) {
    const buffer = _gl.createBuffer()
    if (!buffer) {
      throw new Error('Failed to create WebGL buffer')
    }
    this.buffer = buffer
  }

  /**
   * Выполняет внутреннюю операцию bind.
   */
  bind(target = this._gl.ARRAY_BUFFER): void {
    this._gl.bindBuffer(target, this.buffer)
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    this._gl.deleteBuffer(this.buffer)
  }
}

export class NovaWebGLBuffer {
  readonly buffer: WebGLBuffer

  constructor(private readonly _gl: WebGLRenderingContext) {
    const buffer = _gl.createBuffer()
    if (!buffer) throw new Error('Failed to create WebGL buffer')
    this.buffer = buffer
  }

  bind(target = this._gl.ARRAY_BUFFER): void {
    this._gl.bindBuffer(target, this.buffer)
  }

  destroy(): void {
    this._gl.deleteBuffer(this.buffer)
  }
}

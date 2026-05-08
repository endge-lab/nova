export class NovaWebGLProgram {
  constructor(
    readonly gl: WebGLRenderingContext,
    readonly program: WebGLProgram,
  ) {}

  use(): void {
    this.gl.useProgram(this.program)
  }
}

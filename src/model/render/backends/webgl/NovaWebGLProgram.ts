/**
 * Компилирует и хранит WebGL shader program.
 */
export class NovaWebGLProgram {
  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram,
  ) {}

  /**
   * Выполняет внутреннюю операцию use.
   */
  use(): void {
    this.gl.useProgram(this.program)
  }

  /**
   * Выполняет внутреннюю операцию uniform location.
   */
  uniformLocation(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program, name)
    if (!location) throw new Error(`WebGL uniform "${name}" not found`)
    return location
  }

  /**
   * Выполняет внутреннюю операцию attrib location.
   */
  attribLocation(name: string): number {
    const location = this.gl.getAttribLocation(this.program, name)
    if (location < 0) throw new Error(`WebGL attribute "${name}" not found`)
    return location
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    this.gl.deleteProgram(this.program)
  }

  /**
   * Выполняет внутреннюю операцию create.
   */
  static create(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): NovaWebGLProgram {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) throw new Error('Failed to create WebGL2 program')

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    const linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)

    if (!linked) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown link error'
      gl.deleteProgram(program)
      throw new Error(`Failed to link WebGL2 program: ${log}`)
    }

    return new NovaWebGLProgram(gl, program)
  }
}

/**
 * Компилирует shader.
 */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to create WebGL2 shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean
  if (!compiled) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error'
    gl.deleteShader(shader)
    throw new Error(`Failed to compile WebGL2 shader: ${log}`)
  }

  return shader
}

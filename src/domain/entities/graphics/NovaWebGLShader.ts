export class NovaWebGLShader {
  static createShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader))
      throw new Error('Shader compilation failed')
    }
    return shader
  }

  static createProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
    const vs = this.createShader(gl, vsSrc, gl.VERTEX_SHADER)
    const fs = this.createShader(gl, fsSrc, gl.FRAGMENT_SHADER)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog)
      gl.detachShader(prog, vs)
      gl.detachShader(prog, fs)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteProgram(prog)
      throw new Error('Program linking failed: ' + log)
    }
    gl.detachShader(prog, vs)
    gl.detachShader(prog, fs)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    return prog
  }
}

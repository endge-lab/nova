import type {
  NovaRenderer,
  NovaSchema,
  NovaRect,
  NovaLine,
  NovaCircle,
  NovaIcon,
  NovaText,
  NovaSchemaItem,
  NovaBorder,
  NovaPolygon,
  NovaTextChunk,
} from '@/domain/types/renderer-types'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import { NovaWebGLShader } from '@/model/renderers/webgl_old/NovaWebGLShader'
import { randomString } from '@endge/utils'
import { mat3 } from 'gl-matrix'
import { Telemetry } from '@/model/telemetry.ts'
import { NovaGraphics } from '@/model/renderers/shared/NovaGraphics'
import { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'

// Debug временно для проверки оптимизации батчинга
export let _rectCounter = 0
export function resetRectCounter(): void {
  _rectCounter = 0
}

type NovaWebGLRectCommand = {
  rect: NovaRect
  color: { r: number; g: number; b: number; a: number }
}

type ParsedColor = { r: number; g: number; b: number; a: number }
type RasterBounds = { x: number; y: number; width: number; height: number }

interface TextureCacheEntry {
  texture: WebGLTexture
  width: number
  height: number
  lastUsed: number
}

const FLOATS_PER_VERTEX = 6
const VERTICES_PER_RECT = 6
const FLOATS_PER_RECT = FLOATS_PER_VERTEX * VERTICES_PER_RECT
const TEXTURE_CACHE_LIMIT = 128
const COLOR_KEY_SEPARATOR = '\u0000'

export class NovaRendererWebGLOld implements NovaRenderer {
  readonly id: string = randomString(5)
  readonly novaCanvas: NovaCanvas
  readonly capabilities = {
    canvas2d: false,
    webgl: true,
    schema: true,
    rect: true,
    border: true,
    line: true,
    circle: true,
    polygon: true,
    icon: true,
    text: true,
    measureText: true,
  }

  private readonly gl: WebGLRenderingContext
  private readonly _glId: string

  private readonly program: WebGLProgram
  private readonly positionBuffer: WebGLBuffer
  private readonly uTransformLocation: WebGLUniformLocation
  private readonly uResolutionLocation: WebGLUniformLocation

  private readonly textureProgram: WebGLProgram
  private readonly texturePositionBuffer: WebGLBuffer
  private readonly texCoordBuffer: WebGLBuffer
  private readonly textureTransformLocation: WebGLUniformLocation
  private readonly textureResolutionLocation: WebGLUniformLocation
  private readonly textureSamplerLocation: WebGLUniformLocation
  private readonly textureAlphaLocation: WebGLUniformLocation
  private readonly texturePositionLocation: number
  private readonly textureCoordLocation: number

  private transformMatrix = mat3.create()
  private matrixStack: mat3[] = []
  private readonly _clipStack: RasterBounds[] = []

  private readonly _orderedRects: NovaWebGLRectCommand[] = []
  private _vertexData = new Float32Array(FLOATS_PER_RECT * 256)
  private readonly _measureCanvas = document.createElement('canvas')
  private readonly _rasterCanvas = document.createElement('canvas')
  private readonly _colorCache = new Map<string, ParsedColor>()
  private readonly _textTextureCache = new Map<string, TextureCacheEntry>()
  private readonly _quadVertices = new Float32Array(12)
  private readonly _textureCoords = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
  private readonly _schemaRegistry: NovaSchemaRegistry

  constructor(canvas: NovaCanvas, schemaRegistry = new NovaSchemaRegistry()) {
    this.novaCanvas = canvas
    this._schemaRegistry = schemaRegistry
    this.gl = canvas.getContextWebGL()
    this._glId = (canvas as any)._glId ?? 'gl'

    const vsSource = `
      attribute vec2 a_position;
      attribute vec4 a_color;
      uniform vec2 u_resolution;
      uniform mat3 u_transform;
      varying vec4 v_color;
      void main() {
        vec2 pos = (u_transform * vec3(a_position, 1.0)).xy;
        vec2 zeroToOne = pos / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        v_color = a_color;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      }`

    const fsSource = `
      precision mediump float;
      varying vec4 v_color;
      void main() {
        gl_FragColor = v_color;
      }`

    this.program = NovaWebGLShader.createProgram(this.gl, vsSource, fsSource)
    if (!this.program) throw new Error('Shader program creation failed')

    this.textureProgram = NovaWebGLShader.createProgram(this.gl, this._textureVertexShader(), this._textureFragmentShader())

    this.gl.useProgram(this.program)
    this.gl.enable(this.gl.BLEND)
    this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA)
    this.uTransformLocation = this.gl.getUniformLocation(this.program, 'u_transform')!
    this.uResolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution')!

    this.textureTransformLocation = this.gl.getUniformLocation(this.textureProgram, 'u_transform')!
    this.textureResolutionLocation = this.gl.getUniformLocation(this.textureProgram, 'u_resolution')!
    this.textureSamplerLocation = this.gl.getUniformLocation(this.textureProgram, 'u_texture')!
    this.textureAlphaLocation = this.gl.getUniformLocation(this.textureProgram, 'u_alpha')!
    this.texturePositionLocation = this.gl.getAttribLocation(this.textureProgram, 'a_position')
    this.textureCoordLocation = this.gl.getAttribLocation(this.textureProgram, 'a_texcoord')

    this.positionBuffer = this.gl.createBuffer()!
    this.texturePositionBuffer = this.gl.createBuffer()!
    this.texCoordBuffer = this.gl.createBuffer()!
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this._textureCoords, this.gl.STATIC_DRAW)

    // setTimeout(() => {
    //   this.debugSimulate('invalid_operation')
    // }, 10000)
  }

  get canvas(): NovaCanvas {
    return this.novaCanvas
  }

  get ctx(): WebGLRenderingContext {
    return this.gl
  }

  pushSchema(schema: NovaSchema<any> | NovaSchemaItem[]): void {
    const items = Array.isArray(schema) ? schema : [schema]

    for (const item of items) {
      if (item.active === false) continue

      if (this._isBatchable(item as NovaSchemaItem)) {
        this._pushBatchable(item as NovaSchemaItem)
        continue
      }

      this.popSchema()
      this._drawSchemaItem(item as NovaSchemaItem)
    }
  }

  private _pushBatchable(item: NovaSchemaItem): void {
    if (item.type === 'rect') {
      _rectCounter++
      const background = item.styles?.background
      const opacity = item.styles?.opacity ?? 1
      const hasBg = typeof background === 'string'
      const hasBorder = !!item.styles?.border?.color && !!item.styles?.border?.width

      if (hasBg) {
        this._pushRectCommand(item, background, opacity)
      }

      if (hasBorder) {
        const color = item.styles?.border?.color || '#000000'
        const w = item.styles?.border?.width || 1
        const position = item.styles?.border?.position || 'all'
        const borders = this._buildBorderRects(item.x, item.y, item.width, item.height, color, w, position)

        for (const b of borders) {
          this._pushRectCommand(b, color, opacity)
        }
      }
      return
    }

    if (item.type === 'border') {
      const border = item as NovaBorder
      const color = border.styles?.color
      const w = border.styles?.width
      const position = border?.position || 'all'
      if (!color || !w) return

      const borders = this._buildBorderRects(border.x, border.y, border.width, border.height, color, w, position)
      for (const b of borders) {
        this._pushRectCommand(b, color)
      }
    }
  }

  private _isBatchable(item: NovaSchemaItem): boolean {
    if (item.clip !== undefined && item.clip !== true) return false

    if (item.type === 'rect') {
      return !this._shouldRasterizeRect(item)
    }

    if (item.type === 'border') {
      return !this._shouldRasterizeBorder(item)
    }

    return false
  }

  private _pushRectCommand(rect: NovaRect, color: string, opacity = 1): void {
    this._orderedRects.push({
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      color: this._parseColor(color, opacity),
    })
  }

  popSchema(): void {
    if (this._orderedRects.length === 0) return

    const gl = this.gl
    gl.useProgram(this.program)
    gl.uniform2f(this.uResolutionLocation, this.novaCanvas.width, this.novaCanvas.height)
    this.applyTransform()
    gl.useProgram(this.program)

    const rects = this._orderedRects.length
    let draws = 0

    if (rects > 0) {
      const posLoc = gl.getAttribLocation(this.program, 'a_position')
      const colorLoc = gl.getAttribLocation(this.program, 'a_color')
      const stride = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT
      const requiredFloats = rects * FLOATS_PER_RECT
      this._ensureVertexCapacity(requiredFloats)

      let offset = 0
      for (const command of this._orderedRects) {
        offset = this._writeRectVertices(this._vertexData, offset, command)
      }

      const vertexView = this._vertexData.subarray(0, requiredFloats)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, vertexView.byteLength, gl.DYNAMIC_DRAW)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexView)
      Telemetry.addUploadBytes(vertexView.byteLength)

      this._checkGLError('bufferData')

      gl.enableVertexAttribArray(posLoc)
      gl.enableVertexAttribArray(colorLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0)
      gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT)
      gl.drawArrays(gl.TRIANGLES, 0, rects * VERTICES_PER_RECT)
      this._checkGLError('drawArrays')
      draws++
    }

    this._orderedRects.length = 0

    // + stat в конце кадра
    const dpr = this.novaCanvas.dpr
    const backbufferBytes = Math.floor(this.novaCanvas.width * dpr) * Math.floor(this.novaCanvas.height * dpr) * 4
    Telemetry.stat({
      g: this._glId,
      bytes: Telemetry.consumeAccBytes(),
      draws,
      rects,
      batches: draws,
      backbufferBytes,
    })
  }

  private _ensureVertexCapacity(requiredFloats: number): void {
    if (this._vertexData.length >= requiredFloats) return

    let nextCapacity = this._vertexData.length
    while (nextCapacity < requiredFloats) {
      nextCapacity *= 2
    }
    this._vertexData = new Float32Array(nextCapacity)
  }

  private _writeRectVertices(target: Float32Array, offset: number, command: NovaWebGLRectCommand): number {
    const { rect, color } = command
    const x1 = rect.x
    const y1 = rect.y
    const x2 = rect.x + rect.width
    const y2 = rect.y + rect.height

    offset = this._writeVertex(target, offset, x1, y1, color)
    offset = this._writeVertex(target, offset, x2, y1, color)
    offset = this._writeVertex(target, offset, x1, y2, color)
    offset = this._writeVertex(target, offset, x1, y2, color)
    offset = this._writeVertex(target, offset, x2, y1, color)
    offset = this._writeVertex(target, offset, x2, y2, color)

    return offset
  }

  private _writeVertex(
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    color: { r: number; g: number; b: number; a: number },
  ): number {
    target[offset++] = x
    target[offset++] = y
    target[offset++] = color.r
    target[offset++] = color.g
    target[offset++] = color.b
    target[offset++] = color.a
    return offset
  }

  private _checkGLError(where: string): void {
    const err = this.gl.getError()
    if (err !== this.gl.NO_ERROR) {
      const errName =
        err === this.gl.INVALID_ENUM
          ? 'INVALID_ENUM'
          : err === this.gl.INVALID_VALUE
            ? 'INVALID_VALUE'
            : err === this.gl.INVALID_OPERATION
              ? 'INVALID_OPERATION'
              : err === this.gl.OUT_OF_MEMORY
                ? 'OUT_OF_MEMORY'
                : err === this.gl.CONTEXT_LOST_WEBGL
                  ? 'CONTEXT_LOST_WEBGL'
                  : `UNKNOWN_${err}`

      Telemetry.event('gl:error', { where, code: err, name: errName }, undefined, this._glId)
      console.warn(`[WebGL][${where}]`, errName)
    }
  }

  private _buildBorderRects(
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    w: number,
    position: NovaBorder['position'] = 'all',
  ): NovaRect[] {
    const sides = new Set<string>()

    if (!position || position === 'all') {
      sides.add('top')
      sides.add('right')
      sides.add('bottom')
      sides.add('left')
    } else if (position === 'vertical') {
      sides.add('left')
      sides.add('right')
    } else if (position === 'horizontal') {
      sides.add('top')
      sides.add('bottom')
    } else if (Array.isArray(position)) {
      for (const p of position) {
        sides.add(p)
      }
    }

    const rects: NovaRect[] = []

    if (sides.has('top')) {
      rects.push({
        x,
        y,
        width,
        height: w,
        styles: { background: color },
      })
    }
    if (sides.has('right')) {
      rects.push({
        x: x + width - w,
        y,
        width: w,
        height,
        styles: { background: color },
      })
    }
    if (sides.has('bottom')) {
      rects.push({
        x,
        y: y + height - w,
        width,
        height: w,
        styles: { background: color },
      })
    }
    if (sides.has('left')) {
      rects.push({
        x,
        y,
        width: w,
        height,
        styles: { background: color },
      })
    }

    return rects
  }

  clear(): void {
    this.popSchema()
    this._clipStack.length = 0
    this.gl.disable(this.gl.SCISSOR_TEST)
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
  }

  schema(schema: NovaSchema<any>): void {
    this.schemaBatched(schema)
  }

  schemaBatched(schema: NovaSchema<any>): void {
    this.pushSchema(schema)
    this.popSchema()
  }

  schemaOrdered(schema: NovaSchema<any>): void {
    this.schemaBatched(schema)
  }

  save(): void {
    this.matrixStack.push(mat3.clone(this.transformMatrix))
  }

  restore(): void {
    if (this.matrixStack.length > 0) {
      this.transformMatrix = this.matrixStack.pop()!
      this.applyTransform()
    }
  }

  clip(x: number, y: number, width: number, height: number): void {
    this.popSchema()
    const clip = this._normalizeClip({ x, y, width, height })
    const parent = this._clipStack.length > 0 ? this._clipStack[this._clipStack.length - 1] : undefined
    this._clipStack.push(parent ? this._intersectClip(parent, clip) : clip)
    this._applyClip()
  }

  clearClip(): void {
    this.popSchema()
    if (this._clipStack.length > 0) {
      this._clipStack.pop()
    }
    this._applyClip()
  }

  private _applyClip(): void {
    const clip = this._clipStack.length > 0 ? this._clipStack[this._clipStack.length - 1] : undefined
    if (!clip) {
      this.gl.disable(this.gl.SCISSOR_TEST)
      return
    }

    const dpr = this.novaCanvas.dpr
    const px = Math.round(clip.x * dpr)
    const py = Math.round((this.novaCanvas.height - clip.y - clip.height) * dpr)
    const pw = Math.max(0, Math.round(clip.width * dpr))
    const ph = Math.max(0, Math.round(clip.height * dpr))

    this.gl.enable(this.gl.SCISSOR_TEST)
    this.gl.scissor(px, py, pw, ph)
  }

  private _normalizeClip(clip: RasterBounds): RasterBounds {
    const x1 = Math.min(clip.x, clip.x + clip.width)
    const y1 = Math.min(clip.y, clip.y + clip.height)
    const x2 = Math.max(clip.x, clip.x + clip.width)
    const y2 = Math.max(clip.y, clip.y + clip.height)

    return {
      x: x1,
      y: y1,
      width: Math.max(0, x2 - x1),
      height: Math.max(0, y2 - y1),
    }
  }

  private _intersectClip(a: RasterBounds, b: RasterBounds): RasterBounds {
    const x1 = Math.max(a.x, b.x)
    const y1 = Math.max(a.y, b.y)
    const x2 = Math.min(a.x + a.width, b.x + b.width)
    const y2 = Math.min(a.y + a.height, b.y + b.height)

    return {
      x: x1,
      y: y1,
      width: Math.max(0, x2 - x1),
      height: Math.max(0, y2 - y1),
    }
  }

  private applyTransform(): void {
    this.gl.useProgram(this.program)
    this.gl.uniformMatrix3fv(this.uTransformLocation, false, this.transformMatrix)
    this.gl.useProgram(this.textureProgram)
    this.gl.uniformMatrix3fv(this.textureTransformLocation, false, this.transformMatrix)
  }

  setTransform(matrix: mat3): void {
    mat3.copy(this.transformMatrix, matrix)
    this.applyTransform()
  }

  rect(p: NovaRect): void {
    this.schemaOrdered([{ type: 'rect', ...p }])
  }

  border(p: NovaBorder): void {
    this.schemaOrdered([{ type: 'border', ...p }])
  }

  line(p: NovaLine): void {
    this.popSchema()
    this._drawRasterizedLine(p)
  }

  circle(p: NovaCircle): void {
    this.popSchema()
    this._drawRasterizedCircle(p)
  }

  icon(p: NovaIcon): void {
    this.popSchema()
    const iconObject: CanvasImageSource | undefined =
      typeof p.icon === 'string' ? NovaGraphics.getAsset(p.icon) : p.icon
    if (!iconObject) {
      console.warn(`Icon not found: ${p.icon}`)
      return
    }

    this._drawTextureSource(iconObject as TexImageSource, p.x, p.y, p.width, p.height, p.styles?.opacity ?? 1)
  }

  text(p: NovaText): void {
    this.popSchema()
    if (!p.text?.length) return

    const texture = this._getTextTexture(p)
    this._drawTexture(texture.texture, p.x, p.y, texture.width, texture.height, p.styles?.opacity ?? 1)
  }

  polygon(p: NovaPolygon): void {
    this.popSchema()
    this._drawRasterizedPolygon(p)
  }

  measureText(p: NovaText): { width: number; height: number } {
    const fontSize = p.styles?.font?.size || 12
    const fontFamily = p.styles?.font?.family || 'Verdana'
    const fontWeight = p.styles?.font?.weight || 'normal'
    const fontStyle = p.styles?.font?.style || 'normal'
    const lineHeight = p.styles?.lineHeight || fontSize * 1.2
    const padding = this._resolvePadding(p.styles?.padding)
    const ctx = this._measureCanvas.getContext('2d')!

    let cursorX = 0
    let maxWidth = 0
    let totalLines = 1

    for (const chunk of this._parseMarkdownToChunks(p.text)) {
      if (chunk.newline) {
        maxWidth = Math.max(maxWidth, cursorX)
        cursorX = 0
        totalLines += 1
        continue
      }

      const style = chunk.italic ? 'italic' : fontStyle
      const weight = chunk.bold ? 'bold' : fontWeight
      ctx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`
      cursorX += ctx.measureText(chunk.text).width
    }

    maxWidth = Math.max(maxWidth, cursorX)

    return {
      width: Math.ceil(maxWidth + padding.left + padding.right),
      height: Math.ceil(totalLines * lineHeight),
    }
  }

  private _drawSchemaItem(item: NovaSchemaItem): void {
    if (item.clip !== undefined && item.clip !== true) {
      this.clip(item.clip.x, item.clip.y, item.clip.width, item.clip.height)
      this._drawSchemaPrimitive(item)
      this.clearClip()
      return
    }

    this._drawSchemaPrimitive(item)
  }

  private _drawSchemaPrimitive(item: NovaSchemaItem): void {
    switch (item.type) {
      case 'rect':
        if (this._shouldRasterizeRect(item)) {
          this._drawRasterizedRect(item)
        } else {
          this._pushBatchable(item)
          this.popSchema()
        }
        break
      case 'border':
        if (this._shouldRasterizeBorder(item)) {
          this._drawRasterizedBorder(item)
        } else {
          this._pushBatchable(item)
          this.popSchema()
        }
        break
      case 'line':
        this._drawRasterizedLine(item)
        break
      case 'circle':
        this._drawRasterizedCircle(item)
        break
      case 'polygon':
        this._drawRasterizedPolygon(item)
        break
      case 'icon':
        this.icon(item)
        break
      case 'text':
        this.text(item)
        break
      default:
        this._schemaRegistry.renderSchemaComponent(this, item as any, 'batched')
        break
    }
  }

  private _shouldRasterizeRect(p: NovaRect): boolean {
    return (
      !!p.styles?.border?.radius
      || !!p.styles?.border?.dashPattern
      || (p.styles?.background !== undefined && typeof p.styles.background !== 'string')
    )
  }

  private _shouldRasterizeBorder(p: NovaBorder): boolean {
    return !!p.styles?.radius || !!p.styles?.dashPattern
  }

  private _drawTextureSource(source: TexImageSource, x: number, y: number, width: number, height: number, alpha = 1): void {
    if (width <= 0 || height <= 0) return
    const texture = this._createTexture(source)
    this._drawTexture(texture, x, y, width, height, alpha)
    this.gl.deleteTexture(texture)
  }

  private _drawTexture(texture: WebGLTexture, x: number, y: number, width: number, height: number, alpha = 1): void {
    if (width <= 0 || height <= 0) return

    const gl = this.gl
    this._writeQuadVertices(this._quadVertices, 0, x, y, width, height)

    gl.useProgram(this.textureProgram)
    gl.uniform2f(this.textureResolutionLocation, this.novaCanvas.width, this.novaCanvas.height)
    gl.uniformMatrix3fv(this.textureTransformLocation, false, this.transformMatrix)
    gl.uniform1f(this.textureAlphaLocation, alpha)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texturePositionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this._quadVertices.byteLength, gl.DYNAMIC_DRAW)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._quadVertices)
    gl.enableVertexAttribArray(this.texturePositionLocation)
    gl.vertexAttribPointer(this.texturePositionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(this.textureCoordLocation)
    gl.vertexAttribPointer(this.textureCoordLocation, 2, gl.FLOAT, false, 0, 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(this.textureSamplerLocation, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    Telemetry.addUploadBytes(this._quadVertices.byteLength)
    this._checkGLError('drawTexture')
  }

  private _writeQuadVertices(
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const x2 = x + width
    const y2 = y + height
    target[offset] = x
    target[offset + 1] = y
    target[offset + 2] = x2
    target[offset + 3] = y
    target[offset + 4] = x
    target[offset + 5] = y2
    target[offset + 6] = x
    target[offset + 7] = y2
    target[offset + 8] = x2
    target[offset + 9] = y
    target[offset + 10] = x2
    target[offset + 11] = y2
  }

  private _createTexture(source: TexImageSource): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    this._checkGLError('createTexture')
    return texture
  }

  private _getTextTexture(p: NovaText): TextureCacheEntry {
    const key = this._getTextTextureKey(p)
    const cached = this._textTextureCache.get(key)
    if (cached) {
      cached.lastUsed = performance.now()
      return cached
    }

    const canvas = document.createElement('canvas')
    const dpr = this.novaCanvas.dpr
    canvas.width = Math.max(1, Math.ceil(p.width * dpr))
    canvas.height = Math.max(1, Math.ceil(p.height * dpr))
    canvas.style.width = `${p.width}px`
    canvas.style.height = `${p.height}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    this._drawText2D(ctx, { ...p, x: 0, y: 0 })

    const entry: TextureCacheEntry = {
      texture: this._createTexture(canvas),
      width: p.width,
      height: p.height,
      lastUsed: performance.now(),
    }

    this._textTextureCache.set(key, entry)
    this._trimTextTextureCache()
    return entry
  }

  private _trimTextTextureCache(): void {
    if (this._textTextureCache.size <= TEXTURE_CACHE_LIMIT) return

    const entries = [...this._textTextureCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [key, entry] of entries.slice(0, this._textTextureCache.size - TEXTURE_CACHE_LIMIT)) {
      this.gl.deleteTexture(entry.texture)
      this._textTextureCache.delete(key)
    }
  }

  private _getTextTextureKey(p: NovaText): string {
    return JSON.stringify({
      text: p.text,
      width: p.width,
      height: p.height,
      parser: p.parser,
      styles: p.styles,
      dpr: this.novaCanvas.dpr,
    })
  }

  private _drawWith2DTexture(bounds: RasterBounds, draw: (ctx: CanvasRenderingContext2D) => void): void {
    if (bounds.width <= 0 || bounds.height <= 0) return

    const dpr = this.novaCanvas.dpr
    const canvas = this._rasterCanvas
    canvas.width = Math.max(1, Math.ceil(bounds.width * dpr))
    canvas.height = Math.max(1, Math.ceil(bounds.height * dpr))

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)
    ctx.translate(-bounds.x, -bounds.y)
    draw(ctx)

    this._drawTextureSource(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 1)
  }

  private _drawRasterizedRect(p: NovaRect): void {
    this._drawWith2DTexture({ x: p.x, y: p.y, width: p.width, height: p.height }, (ctx) => {
      ctx.save()
      if (p.styles?.opacity !== undefined) ctx.globalAlpha = p.styles.opacity

      if (p.styles?.background) {
        ctx.fillStyle =
          typeof p.styles.background === 'string'
            ? p.styles.background
            : ctx.createPattern(p.styles.background, 'repeat')!
        this._roundedRectPath(ctx, p.x, p.y, p.width, p.height, p.styles.border?.radius || 0)
        ctx.fill()
      }

      if (p.styles?.border?.width) {
        ctx.strokeStyle = p.styles.border.color || '#000'
        ctx.lineWidth = p.styles.border.width
        if (p.styles.border.dashPattern) ctx.setLineDash(p.styles.border.dashPattern)
        this._roundedRectPath(ctx, p.x, p.y, p.width, p.height, p.styles.border.radius || 0)
        ctx.stroke()
      }

      ctx.restore()
    })
  }

  private _drawRasterizedBorder(p: NovaBorder): void {
    this._drawWith2DTexture({ x: p.x, y: p.y, width: p.width, height: p.height }, (ctx) => {
      ctx.save()
      ctx.strokeStyle = p.styles?.color || '#000'
      ctx.lineWidth = p.styles?.width || 1
      if (p.styles?.dashPattern) ctx.setLineDash(p.styles.dashPattern)

      if (p.styles?.radius) {
        this._roundedRectPath(ctx, p.x, p.y, p.width, p.height, p.styles.radius)
        ctx.stroke()
      } else {
        const half = (p.styles?.width || 1) / 2
        const sides = this._getBorderSides(p.position)
        if (sides.has('top')) {
          ctx.beginPath()
          ctx.moveTo(p.x, p.y + half)
          ctx.lineTo(p.x + p.width, p.y + half)
          ctx.stroke()
        }
        if (sides.has('right')) {
          ctx.beginPath()
          ctx.moveTo(p.x + p.width - half, p.y)
          ctx.lineTo(p.x + p.width - half, p.y + p.height)
          ctx.stroke()
        }
        if (sides.has('bottom')) {
          ctx.beginPath()
          ctx.moveTo(p.x, p.y + p.height - half)
          ctx.lineTo(p.x + p.width, p.y + p.height - half)
          ctx.stroke()
        }
        if (sides.has('left')) {
          ctx.beginPath()
          ctx.moveTo(p.x + half, p.y)
          ctx.lineTo(p.x + half, p.y + p.height)
          ctx.stroke()
        }
      }

      ctx.restore()
    })
  }

  private _drawRasterizedLine(p: NovaLine): void {
    const w = p.styles?.width || 1
    const pad = w + 2
    const bounds = {
      x: Math.min(p.x1, p.x2) - pad,
      y: Math.min(p.y1, p.y2) - pad,
      width: Math.abs(p.x2 - p.x1) + pad * 2,
      height: Math.abs(p.y2 - p.y1) + pad * 2,
    }

    this._drawWith2DTexture(bounds, (ctx) => {
      ctx.save()
      ctx.strokeStyle = p.styles?.color || '#000'
      ctx.lineWidth = w
      ctx.globalAlpha = p.styles?.opacity ?? 1
      ctx.setLineDash(p.styles?.dashPattern || [])
      ctx.beginPath()
      ctx.moveTo(p.x1, p.y1)
      ctx.lineTo(p.x2, p.y2)
      ctx.stroke()
      ctx.restore()
    })
  }

  private _drawRasterizedCircle(p: NovaCircle): void {
    const borderWidth = p.styles?.border?.width || 0
    const pad = borderWidth + 2
    const bounds = {
      x: p.x - p.radius - pad,
      y: p.y - p.radius - pad,
      width: p.radius * 2 + pad * 2,
      height: p.radius * 2 + pad * 2,
    }

    this._drawWith2DTexture(bounds, (ctx) => {
      ctx.save()
      ctx.globalAlpha = p.styles?.opacity ?? 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      if (p.styles?.background) {
        ctx.fillStyle =
          typeof p.styles.background === 'string'
            ? p.styles.background
            : ctx.createPattern(p.styles.background, 'repeat')!
        ctx.fill()
      }
      if (p.styles?.border?.width) {
        ctx.strokeStyle = p.styles.border.color || '#000'
        ctx.lineWidth = p.styles.border.width
        if (p.styles.border.dashPattern) ctx.setLineDash(p.styles.border.dashPattern)
        ctx.stroke()
      }
      ctx.restore()
    })
  }

  private _drawRasterizedPolygon(p: NovaPolygon): void {
    if (p.points.length === 0) return

    const lineWidth = p.styles?.lineWidth || 1
    const minX = Math.min(...p.points.map(point => point.x)) - lineWidth - 2
    const minY = Math.min(...p.points.map(point => point.y)) - lineWidth - 2
    const maxX = Math.max(...p.points.map(point => point.x)) + lineWidth + 2
    const maxY = Math.max(...p.points.map(point => point.y)) + lineWidth + 2

    this._drawWith2DTexture({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, (ctx) => {
      ctx.save()
      ctx.globalAlpha = p.styles?.opacity ?? 1
      ctx.beginPath()
      ctx.moveTo(p.points[0].x, p.points[0].y)
      for (let i = 1; i < p.points.length; i++) {
        ctx.lineTo(p.points[i].x, p.points[i].y)
      }
      ctx.closePath()

      if (p.styles?.background) {
        ctx.fillStyle = p.styles.background
        ctx.fill()
      }
      if (p.styles?.stroke) {
        ctx.strokeStyle = p.styles.stroke
        ctx.lineWidth = lineWidth
        ctx.stroke()
      }
      ctx.restore()
    })
  }

  private _drawText2D(ctx: CanvasRenderingContext2D, p: NovaText): void {
    const padding = this._resolvePadding(p.styles?.padding)
    const hasPadding = padding.left !== 0 || padding.right !== 0 || padding.top !== 0 || padding.bottom !== 0
    const shouldClipToInner = p.clip === true || hasPadding

    ctx.save()
    if (shouldClipToInner) {
      const clipX = p.x + (hasPadding ? padding.left : 0)
      const clipY = p.y + (hasPadding ? padding.top : 0)
      const clipWidth = Math.max(0, p.width - (hasPadding ? padding.left + padding.right : 0))
      const clipHeight = Math.max(0, p.height - (hasPadding ? padding.top + padding.bottom : 0))
      ctx.beginPath()
      ctx.rect(clipX, clipY, clipWidth, clipHeight)
      ctx.clip()
    }

    if (p.parser === 'markdown') {
      this._drawMarkdownText2D(ctx, p)
      ctx.restore()
      return
    }

    const fontSize = p.styles?.font?.size || 12
    const fontFamily = p.styles?.font?.family || 'Verdana'
    const fontWeight = p.styles?.font?.weight || 'normal'
    const fontStyle = p.styles?.font?.style || 'normal'
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
    ctx.fillStyle = p.styles?.color || '#000'
    ctx.globalAlpha = p.styles?.opacity ?? 1

    const availableWidth = Math.max(0, p.width - (padding.left + padding.right))
    const rawTextWidth = ctx.measureText(p.text).width
    const isOverflow = rawTextWidth > availableWidth
    let horizontal = p.styles?.align?.horizontal || 'left'

    if (isOverflow) {
      horizontal = 'left'
    }

    let textX = p.x
    let textY = p.y

    switch (horizontal) {
      case 'right':
        textX += p.width - padding.right
        ctx.textAlign = 'right'
        break
      case 'center':
        textX += padding.left + availableWidth / 2
        ctx.textAlign = 'center'
        break
      default:
        textX += padding.left
        ctx.textAlign = 'left'
        break
    }

    switch (p.styles?.align?.vertical) {
      case 'top':
        textY += padding.top
        ctx.textBaseline = 'top'
        break
      case 'bottom':
        textY += p.height - padding.bottom
        ctx.textBaseline = 'bottom'
        break
      default:
        textY += p.height / 2
        ctx.textBaseline = 'middle'
        break
    }

    let finalText = p.text
    if (p.styles?.ellipsis) {
      while (finalText.length > 0 && ctx.measureText(`${finalText}...`).width > availableWidth) {
        finalText = finalText.slice(0, -1)
      }
      if (finalText.length > 0 && finalText !== p.text) {
        finalText += '...'
      }
    }

    ctx.fillText(finalText, textX, textY)
    ctx.restore()
  }

  private _drawMarkdownText2D(ctx: CanvasRenderingContext2D, p: NovaText): void {
    const fontSize = p.styles?.font?.size || 12
    const fontFamily = p.styles?.font?.family || 'Verdana'
    const fontWeight = p.styles?.font?.weight || 'normal'
    const fontStyle = p.styles?.font?.style || 'normal'
    const lineHeight = p.styles?.lineHeight || fontSize * 1.2
    const padding = this._resolvePadding(p.styles?.padding)
    let cursorX = p.x + padding.left
    let cursorY = p.y + padding.top

    ctx.fillStyle = p.styles?.color || '#000'
    ctx.globalAlpha = p.styles?.opacity ?? 1
    ctx.textBaseline = 'top'

    for (const chunk of this._parseMarkdownToChunks(p.text)) {
      if (chunk.newline) {
        cursorX = p.x + padding.left
        cursorY += lineHeight
        continue
      }

      ctx.font = `${chunk.italic ? 'italic' : fontStyle} ${chunk.bold ? 'bold' : fontWeight} ${fontSize}px ${fontFamily}`
      ctx.fillText(chunk.text, cursorX, cursorY)
      cursorX += ctx.measureText(chunk.text).width
    }
  }

  private _roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + r)
    ctx.lineTo(x + width, y + height - r)
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    ctx.lineTo(x + r, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  private _resolvePadding(padding: any): {
    left: number
    right: number
    top: number
    bottom: number
  } {
    if (!padding) return { left: 0, right: 0, top: 0, bottom: 0 }
    if ('all' in padding) {
      return { left: padding.all, right: padding.all, top: padding.all, bottom: padding.all }
    }
    if ('horizontal' in padding || 'vertical' in padding) {
      return {
        left: padding.horizontal || 0,
        right: padding.horizontal || 0,
        top: padding.vertical || 0,
        bottom: padding.vertical || 0,
      }
    }
    return {
      left: padding.left || 0,
      right: padding.right || 0,
      top: padding.top || 0,
      bottom: padding.bottom || 0,
    }
  }

  private _parseMarkdownToChunks(input: string): NovaTextChunk[] {
    if (!input?.length) {
      return [{ text: '' }]
    }
    const lines = input.split('\n')
    const chunks: NovaTextChunk[] = []

    for (const line of lines) {
      const parts = line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
      for (const part of parts) {
        if (!part) continue

        if (/^\*\*(.+)\*\*$/.test(part)) {
          chunks.push({ text: part.slice(2, -2), bold: true })
        } else if (/^_(.+)_$/.test(part)) {
          chunks.push({ text: part.slice(1, -1), italic: true })
        } else {
          chunks.push({ text: part })
        }
      }
      chunks.push({ newline: true, text: '' })
    }

    return chunks
  }

  private _getBorderSides(position: NovaBorder['position'] = 'all'): Set<string> {
    const sides = new Set<string>()

    if (!position || position === 'all') {
      sides.add('top')
      sides.add('right')
      sides.add('bottom')
      sides.add('left')
    } else if (position === 'vertical') {
      sides.add('left')
      sides.add('right')
    } else if (position === 'horizontal') {
      sides.add('top')
      sides.add('bottom')
    } else if (Array.isArray(position)) {
      for (const p of position) sides.add(p)
    }

    return sides
  }

  private _parseColor(input: string, opacity = 1): ParsedColor {
    if (typeof input !== 'string') return { r: 0, g: 0, b: 0, a: opacity }

    const key = `${opacity}${COLOR_KEY_SEPARATOR}${input.trim()}`
    const cached = this._colorCache.get(key)
    if (cached) return cached

    const parsed = this._parseCssColor(input.trim())
    const color = {
      r: parsed.r,
      g: parsed.g,
      b: parsed.b,
      a: parsed.a * opacity,
    }
    this._colorCache.set(key, color)
    return color
  }

  private _parseCssColor(input: string): ParsedColor {
    const s = input.trim()
    const lower = s.toLowerCase()

    if (!s || lower === 'transparent' || lower === 'none') {
      return { r: 0, g: 0, b: 0, a: 0 }
    }

    if (s.startsWith('#')) {
      const hex = s.slice(1)
      const toFloat = (str: string) => parseInt(str, 16) / 255

      if (hex.length === 3) {
        return {
          r: toFloat(hex[0] + hex[0]),
          g: toFloat(hex[1] + hex[1]),
          b: toFloat(hex[2] + hex[2]),
          a: 1,
        }
      }

      if (hex.length === 6) {
        return {
          r: toFloat(hex.slice(0, 2)),
          g: toFloat(hex.slice(2, 4)),
          b: toFloat(hex.slice(4, 6)),
          a: 1,
        }
      }

      if (hex.length === 8) {
        return {
          r: toFloat(hex.slice(0, 2)),
          g: toFloat(hex.slice(2, 4)),
          b: toFloat(hex.slice(4, 6)),
          a: toFloat(hex.slice(6, 8)),
        }
      }
    }

    if (lower.startsWith('rgba') || lower.startsWith('rgb')) {
      const match = s.match(/rgba?\(([^)]+)\)/i)
      if (!match) return { r: 0, g: 0, b: 0, a: 0 }

      const [channelsSource, alphaSource] = match[1].split('/').map(part => part.trim())
      const rawParts = channelsSource.includes(',')
        ? channelsSource.split(',').map(part => part.trim())
        : channelsSource.split(/\s+/).filter(Boolean)
      const alphaPart = alphaSource ?? (rawParts.length > 3 ? rawParts[3] : undefined)

      if (rawParts.length < 3) return { r: 0, g: 0, b: 0, a: 0 }

      const parseChannel = (part: string): number => {
        if (part.endsWith('%')) return Math.max(0, Math.min(1, parseFloat(part) / 100))
        return Math.max(0, Math.min(1, parseFloat(part) / 255))
      }
      const parseAlpha = (part: string | undefined): number => {
        if (!part) return 1
        if (part.endsWith('%')) return Math.max(0, Math.min(1, parseFloat(part) / 100))
        return Math.max(0, Math.min(1, parseFloat(part)))
      }

      return {
        r: parseChannel(rawParts[0]),
        g: parseChannel(rawParts[1]),
        b: parseChannel(rawParts[2]),
        a: parseAlpha(alphaPart),
      }
    }

    const ctx = this._measureCanvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#010203'
      ctx.fillStyle = s
      const normalized = ctx.fillStyle
      if (typeof normalized === 'string' && normalized !== '#010203') {
        return this._parseCssColor(normalized)
      }
    }

    return { r: 0, g: 0, b: 0, a: 0 }
  }

  private _textureVertexShader(): string {
    return `
      attribute vec2 a_position;
      attribute vec2 a_texcoord;
      uniform vec2 u_resolution;
      uniform mat3 u_transform;
      varying vec2 v_texcoord;
      void main() {
        vec2 pos = (u_transform * vec3(a_position, 1.0)).xy;
        vec2 zeroToOne = pos / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        v_texcoord = a_texcoord;
      }`
  }

  private _textureFragmentShader(): string {
    return `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_alpha;
      varying vec2 v_texcoord;
      void main() {
        vec4 color = texture2D(u_texture, v_texcoord);
        gl_FragColor = vec4(color.rgb, color.a * u_alpha);
      }`
  }

  destroy(): void {
    try {
      // Отключаем использование программы
      this.gl.useProgram(null)

      // Удаляем WebGL ресурсы
      this.gl.deleteBuffer(this.positionBuffer)
      this.gl.deleteBuffer(this.texturePositionBuffer)
      this.gl.deleteBuffer(this.texCoordBuffer)
      this.gl.deleteProgram(this.program)
      this.gl.deleteProgram(this.textureProgram)
      for (const entry of this._textTextureCache.values()) {
        this.gl.deleteTexture(entry.texture)
      }

      // Очистка ссылок
      this._orderedRects.length = 0
      this.matrixStack.length = 0
      this._clipStack.length = 0
      this._textTextureCache.clear()
      this._colorCache.clear()

    } catch (err) {
      console.error('[NovaRendererWebGLOld] Error during destroy:', err)
    }
  }

  cursor(value: string): void {
    this.novaCanvas.element.style.cursor = value
  }

  debugSimulate(kind: 'invalid_enum' | 'invalid_value' | 'invalid_operation' | 'oom' | 'lost'): void {
    const gl = this.gl
    const aPosLoc = gl.getAttribLocation(this.program, 'a_position')

    const safeBind = () => {
      gl.useProgram(this.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
      if (aPosLoc >= 0) {
        gl.enableVertexAttribArray(aPosLoc)
        gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0)
      }
    }

    switch (kind) {
      case 'invalid_enum': {
        gl.enable(999999)
        this._checkGLError('sim:invalid_enum')
        break
      }

      case 'invalid_value': {
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(-1, 0, 10, 10)
        this._checkGLError('sim:invalid_value')
        gl.disable(gl.SCISSOR_TEST)
        break
      }

      case 'invalid_operation': {
        gl.useProgram(null)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        this._checkGLError('sim:invalid_operation')
        safeBind()
        break
      }

      case 'oom': {
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
        const sz = Math.min(16384, max * 2)
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sz, sz, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        this._checkGLError('sim:oom')
        gl.deleteTexture(tex)
        break
      }

      case 'lost': {
        const lose = gl.getExtension('WEBGL_lose_context') as any
        if (lose?.loseContext) {
          lose.loseContext()
          gl.clear(gl.COLOR_BUFFER_BIT)
          this._checkGLError('sim:lost')
        }
        break
      }
    }
  }
}

import { randomString } from '@endge/utils'
import type { mat3 } from 'gl-matrix'
import type {
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaLine,
  NovaPolygon,
  NovaRect,
  NovaRenderer,
  NovaRendererCapabilities,
  NovaSchema,
  NovaText,
} from '@/domain/types/renderer-types'
import type { NovaRenderFrame, NovaRenderMetrics, NovaRendererConfig } from '@/domain/types/rendering/index'
import type { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import { DEFAULT_NOVA_RENDERER_CONFIG } from '@/model/rendering/policy/NovaRenderPolicy'
import { NovaWebGLDevice } from '@/model/renderers/webgl/NovaWebGLDevice'
import { NovaWebGLDiagnostics } from '@/model/renderers/webgl/NovaWebGLDiagnostics'
import { NovaWebGLFrameRenderer } from '@/model/renderers/webgl/NovaWebGLFrameRenderer'
import { NovaWebGLTargetManager } from '@/model/renderers/webgl/NovaWebGLTargetManager'
import { NovaWebGLTextRenderer } from '@/model/renderers/webgl/NovaWebGLTextRenderer'
import { NovaWebGLTextureManager } from '@/model/renderers/webgl/NovaWebGLTextureManager'

export class NovaRendererWebGL implements NovaRenderer {
  readonly id: string = randomString(5)
  readonly capabilities: NovaRendererCapabilities = {
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

  readonly device: NovaWebGLDevice
  readonly diagnostics = new NovaWebGLDiagnostics()
  readonly targets: NovaWebGLTargetManager
  readonly textures: NovaWebGLTextureManager
  readonly textRenderer: NovaWebGLTextRenderer

  private readonly _frameRenderer: NovaWebGLFrameRenderer

  constructor(
    readonly novaCanvas: NovaCanvas,
    _schemaRegistry: NovaSchemaRegistry,
    rendererConfig: NovaRendererConfig = DEFAULT_NOVA_RENDERER_CONFIG,
  ) {
    this.device = new NovaWebGLDevice(novaCanvas)
    this.targets = new NovaWebGLTargetManager(this.device.gl)
    this.textures = new NovaWebGLTextureManager(this.device.gl)
    this.textRenderer = new NovaWebGLTextRenderer(rendererConfig.text)
    this._frameRenderer = new NovaWebGLFrameRenderer(this.device)
  }

  renderFrame(frame: NovaRenderFrame): NovaRenderMetrics {
    const metrics = this._frameRenderer.render(frame)
    this.diagnostics.capture(frame, metrics)
    return metrics
  }

  schema(_schema: NovaSchema<any>): void {
    this.throwImmediateApiError('schema')
  }

  save(): void {
    this.throwImmediateApiError('save')
  }

  restore(): void {
    this.throwImmediateApiError('restore')
  }

  clear(): void {
    this.throwImmediateApiError('clear')
  }

  clip(_x: number, _y: number, _width: number, _height: number): void {
    this.throwImmediateApiError('clip')
  }

  clearClip(): void {
    this.throwImmediateApiError('clearClip')
  }

  setTransform(_matrix: mat3): void {
    this.throwImmediateApiError('setTransform')
  }

  text(_params: NovaText): void {
    this.throwImmediateApiError('text')
  }

  rect(_params: NovaRect): void {
    this.throwImmediateApiError('rect')
  }

  border(_params: NovaBorder): void {
    this.throwImmediateApiError('border')
  }

  line(_params: NovaLine): void {
    this.throwImmediateApiError('line')
  }

  circle(_params: NovaCircle): void {
    this.throwImmediateApiError('circle')
  }

  polygon(_params: NovaPolygon): void {
    this.throwImmediateApiError('polygon')
  }

  icon(_params: NovaIcon): void {
    this.throwImmediateApiError('icon')
  }

  measureText(params: NovaText): { width: number; height: number } {
    return this._frameRenderer.measureText(params)
  }

  cursor(type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void {
    this.novaCanvas.element.style.cursor = type
  }

  destroy(): void {
    this._frameRenderer.destroy()
    this.textures.destroy()
  }

  private throwImmediateApiError(method: string): never {
    throw new Error(
      `NovaRendererWebGL.${method}() is not an immediate rendering API. Use NovaRenderCompiler/NovaRenderContext and renderFrame() for RendererType.WebGL.`,
    )
  }
}

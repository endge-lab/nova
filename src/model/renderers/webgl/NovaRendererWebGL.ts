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
import { NovaRendererWebGLOld } from '@/model/renderers/webgl_old/NovaRendererWebGLOld'
import type { NovaSchemaRegistry } from '@/model/core/NovaSchemaRegistry'
import { NovaSchemaRegistry as NovaSchemaRegistryCtor } from '@/model/core/NovaSchemaRegistry'
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

  private readonly _compatRenderer: NovaRendererWebGLOld
  private readonly _frameRenderer: NovaWebGLFrameRenderer

  constructor(
    readonly novaCanvas: NovaCanvas,
    schemaRegistry: NovaSchemaRegistry = new NovaSchemaRegistryCtor(),
    rendererConfig: NovaRendererConfig = DEFAULT_NOVA_RENDERER_CONFIG,
  ) {
    this.device = new NovaWebGLDevice(novaCanvas)
    this.targets = new NovaWebGLTargetManager(this.device.gl)
    this.textures = new NovaWebGLTextureManager(this.device.gl)
    this.textRenderer = new NovaWebGLTextRenderer(rendererConfig.text)
    this._compatRenderer = new NovaRendererWebGLOld(novaCanvas, schemaRegistry)
    this._frameRenderer = new NovaWebGLFrameRenderer(this._compatRenderer)
  }

  renderFrame(frame: NovaRenderFrame): NovaRenderMetrics {
    const metrics = this._frameRenderer.render(frame)
    this.diagnostics.capture(frame, metrics)
    return metrics
  }

  schema(schema: NovaSchema<any>): void {
    this._compatRenderer.schema(schema)
  }

  schemaBatched(schema: NovaSchema<any>): void {
    this._compatRenderer.schemaBatched(schema)
  }

  schemaOrdered(schema: NovaSchema<any>): void {
    this._compatRenderer.schemaOrdered(schema)
  }

  save(): void {
    this._compatRenderer.save()
  }

  restore(): void {
    this._compatRenderer.restore()
  }

  clear(): void {
    this._compatRenderer.clear()
  }

  clip(x: number, y: number, width: number, height: number): void {
    this._compatRenderer.clip(x, y, width, height)
  }

  clearClip(): void {
    this._compatRenderer.clearClip()
  }

  setTransform(matrix: mat3): void {
    this._compatRenderer.setTransform(matrix)
  }

  text(params: NovaText): void {
    this._compatRenderer.text(params)
  }

  rect(params: NovaRect): void {
    this._compatRenderer.rect(params)
  }

  border(params: NovaBorder): void {
    this._compatRenderer.border(params)
  }

  line(params: NovaLine): void {
    this._compatRenderer.line(params)
  }

  circle(params: NovaCircle): void {
    this._compatRenderer.circle(params)
  }

  polygon(params: NovaPolygon): void {
    this._compatRenderer.polygon(params)
  }

  icon(params: NovaIcon): void {
    this._compatRenderer.icon(params)
  }

  measureText(params: NovaText): { width: number; height: number } {
    return this._compatRenderer.measureText(params)
  }

  cursor(type: 'default' | 'pointer' | 'col-resize' | 'row-resize'): void {
    this._compatRenderer.cursor(type)
  }

  destroy(): void {
    this.textures.destroy()
    this._compatRenderer.destroy()
  }
}

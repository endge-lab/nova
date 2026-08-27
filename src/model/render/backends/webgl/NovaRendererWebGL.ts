import type { mat3 } from 'gl-matrix'
import type {
  NovaArc,
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaIconBatch,
  NovaLine,
  NovaParticleBatch,
  NovaPatternRect,
  NovaPolygon,
  NovaRect,
  NovaRectBatch,
  NovaRenderer,
  NovaRendererCapabilities,
  NovaRendererStateMark,
  NovaSchema,
  NovaStripeRectBatch,
  NovaText,
  NovaTextBatch,
  NovaTimeRangeSegmentBatch,
} from '@/domain/types/renderer.types'
import type { NovaRendererConfig, NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import type { NovaAssetRegistry } from '@/model/runtime/assets/NovaAssetRegistry'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import { randomString } from '@endge/utils'
import { RendererType } from '@/domain/types/renderer.types'
import { NovaWebGLDevice } from '@/model/render/backends/webgl/NovaWebGLDevice'
import { NovaWebGLDiagnostics } from '@/model/render/backends/webgl/NovaWebGLDiagnostics'
import { NovaWebGLFrameRenderer } from '@/model/render/backends/webgl/NovaWebGLFrameRenderer'
import { NovaWebGLTargetManager } from '@/model/render/backends/webgl/NovaWebGLTargetManager'
import { NovaWebGLTextRenderer } from '@/model/render/backends/webgl/NovaWebGLTextRenderer'
import { NovaWebGLTextureManager } from '@/model/render/backends/webgl/NovaWebGLTextureManager'
import { DEFAULT_NOVA_RENDERER_CONFIG } from '@/model/render/policy/nova-render-policy'
import { NovaAssets } from '@/model/runtime/assets/NovaAssetRegistry'

/**
 * Реализует WebGL renderer для compiled Nova render frames.
 */
export class NovaRendererWebGL implements NovaRenderer, NovaRenderBackend {
  readonly id: string = randomString(5)
  readonly type = RendererType.WebGL
  readonly capabilities: NovaRendererCapabilities = {
    canvas2d: false,
    webgl: true,
    schema: true,
    rect: true,
    border: true,
    line: true,
    circle: true,
    arc: true,
    polygon: true,
    icon: true,
    text: true,
    patternRects: true,
    particles: true,
    rectBatches: true,
    stripeBatches: true,
    iconBatches: true,
    textBatches: true,
    measureText: true,
  }

  readonly device: NovaWebGLDevice
  readonly diagnostics = new NovaWebGLDiagnostics()
  readonly targets: NovaWebGLTargetManager
  readonly textures: NovaWebGLTextureManager
  readonly textRenderer: NovaWebGLTextRenderer

  private readonly _frameRenderer: NovaWebGLFrameRenderer

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    readonly novaCanvas: NovaCanvas,
    _schemaRegistry: NovaSchemaRegistry,
    rendererConfig: NovaRendererConfig = DEFAULT_NOVA_RENDERER_CONFIG,
    assets: NovaAssetRegistry = NovaAssets.global,
  ) {
    this.device = new NovaWebGLDevice(novaCanvas)
    this.targets = new NovaWebGLTargetManager(this.device.gl)
    this.textures = new NovaWebGLTextureManager(this.device.gl)
    this.textRenderer = new NovaWebGLTextRenderer(rendererConfig.text)
    this._frameRenderer = new NovaWebGLFrameRenderer(this.device, rendererConfig.text, assets)
  }

  /**
   * Выполняет render-операцию frame.
   */
  renderFrame(frame: NovaRenderFrame): NovaRenderMetrics {
    const metrics = this._frameRenderer.render(frame)
    this.diagnostics.capture(frame, metrics)
    return metrics
  }

  /**
   * Очищает root render target один раз перед ordered surface replay.
   */
  clearRoot(): void {
    this.device.clear()
  }

  /**
   * Выполняет внутреннюю операцию schema.
   */
  schema(_schema: NovaSchema<any>): void {
    this.throwImmediateApiError('schema')
  }

  /**
   * Выполняет внутреннюю операцию save.
   */
  save(): void {
    this.throwImmediateApiError('save')
  }

  /**
   * Выполняет внутреннюю операцию restore.
   */
  restore(): void {
    this.throwImmediateApiError('restore')
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    this.throwImmediateApiError('clear')
  }

  /**
   * Выполняет внутреннюю операцию clip.
   */
  clip(_x: number, _y: number, _width: number, _height: number): void {
    this.throwImmediateApiError('clip')
  }

  /**
   * Очищает clip.
   */
  clearClip(): void {
    this.throwImmediateApiError('clearClip')
  }

  /**
   * Сохраняет границу mutable render-state.
   */
  markState(): NovaRendererStateMark {
    this.throwImmediateApiError('markState')
  }

  /**
   * Восстанавливает mutable render-state до сохраненной границы.
   */
  restoreState(_mark: NovaRendererStateMark): void {
    this.throwImmediateApiError('restoreState')
  }

  /**
   * Обновляет transform.
   */
  setTransform(_matrix: mat3): void {
    this.throwImmediateApiError('setTransform')
  }

  /**
   * Выполняет внутреннюю операцию text.
   */
  text(_params: NovaText): void {
    this.throwImmediateApiError('text')
  }

  /**
   * Выполняет внутреннюю операцию rect.
   */
  rect(_params: NovaRect): void {
    this.throwImmediateApiError('rect')
  }

  /**
   * Выполняет внутреннюю операцию border.
   */
  border(_params: NovaBorder): void {
    this.throwImmediateApiError('border')
  }

  /**
   * Выполняет внутреннюю операцию line.
   */
  line(_params: NovaLine): void {
    this.throwImmediateApiError('line')
  }

  /**
   * Выполняет внутреннюю операцию circle.
   */
  circle(_params: NovaCircle): void {
    this.throwImmediateApiError('circle')
  }

  /**
   * Выполняет внутреннюю операцию arc.
   */
  arc(_params: NovaArc): void {
    this.throwImmediateApiError('arc')
  }

  /**
   * Выполняет внутреннюю операцию polygon.
   */
  polygon(_params: NovaPolygon): void {
    this.throwImmediateApiError('polygon')
  }

  /**
   * Выполняет внутреннюю операцию icon.
   */
  icon(_params: NovaIcon): void {
    this.throwImmediateApiError('icon')
  }

  /**
   * Выполняет внутреннюю операцию patternRect.
   */
  patternRect(_params: NovaPatternRect): void {
    this.throwImmediateApiError('patternRect')
  }

  /**
   * Выполняет внутреннюю операцию particles.
   */
  particles(_batch: NovaParticleBatch): void {
    this.throwImmediateApiError('particles')
  }

  /**
   * Выполняет внутреннюю операцию rects.
   */
  rects(_batch: NovaRectBatch): void {
    this.throwImmediateApiError('rects')
  }

  /**
   * Выполняет внутреннюю операцию timeRangeSegments.
   */
  timeRangeSegments(_batch: NovaTimeRangeSegmentBatch): void {
    this.throwImmediateApiError('timeRangeSegments')
  }

  /**
   * Выполняет внутреннюю операцию stripes.
   */
  stripes(_batch: NovaStripeRectBatch): void {
    this.throwImmediateApiError('stripes')
  }

  /**
   * Выполняет внутреннюю операцию icons.
   */
  icons(_batch: NovaIconBatch): void {
    this.throwImmediateApiError('icons')
  }

  /**
   * Выполняет внутреннюю операцию texts.
   */
  texts(_batch: NovaTextBatch): void {
    this.throwImmediateApiError('texts')
  }

  /**
   * Выполняет внутреннюю операцию measure text.
   */
  measureText(params: NovaText): { width: number, height: number } {
    return this._frameRenderer.measureText(params)
  }

  /**
   * Выполняет внутреннюю операцию cursor.
   */
  cursor(type: string): void {
    this.novaCanvas.element.style.cursor = type
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    this._frameRenderer.destroy()
    this.textures.destroy()
  }

  /**
   * Выполняет внутреннюю операцию throw immediate api error.
   */
  private throwImmediateApiError(method: string): never {
    throw new Error(
      `NovaRendererWebGL.${method}() is not an immediate rendering API. Use NovaRenderCompiler/NovaRenderContext and renderFrame() for RendererType.WebGL.`,
    )
  }
}

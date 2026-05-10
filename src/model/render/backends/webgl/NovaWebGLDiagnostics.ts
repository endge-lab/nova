import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'

/**
 * Рисует diagnostic overlays и debug-визуализацию WebGL renderer.
 */
export class NovaWebGLDiagnostics {
  private _lastFrame?: NovaRenderFrame
  private _lastMetrics?: NovaRenderMetrics

  /**
   * Возвращает last frame.
   */
  get lastFrame(): NovaRenderFrame | undefined {
    return this._lastFrame
  }

  /**
   * Возвращает last metrics.
   */
  get lastMetrics(): NovaRenderMetrics | undefined {
    return this._lastMetrics
  }

  /**
   * Выполняет внутреннюю операцию capture.
   */
  capture(frame: NovaRenderFrame, metrics: NovaRenderMetrics): void {
    this._lastFrame = frame
    this._lastMetrics = metrics
  }
}

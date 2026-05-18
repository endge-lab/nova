import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'

/**
 * Рисует diagnostic overlays и debug-визуализацию WebGL renderer.
 */
export class NovaWebGLDiagnostics {
  private _enabled = false
  private _lastFrame?: NovaRenderFrame
  private _lastMetrics?: NovaRenderMetrics

  /**
   * Возвращает enabled.
   */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * Обновляет enabled и сбрасывает retained diagnostics при выключении.
   */
  set enabled(value: boolean) {
    this._enabled = value
    if (!value) {
      this._lastFrame = undefined
      this._lastMetrics = undefined
    }
  }

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
    if (!this._enabled) return
    this._lastFrame = frame
    this._lastMetrics = metrics
  }
}

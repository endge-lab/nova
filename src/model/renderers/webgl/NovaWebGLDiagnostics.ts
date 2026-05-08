import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'

export class NovaWebGLDiagnostics {
  private _lastFrame?: NovaRenderFrame
  private _lastMetrics?: NovaRenderMetrics

  get lastFrame(): NovaRenderFrame | undefined {
    return this._lastFrame
  }

  get lastMetrics(): NovaRenderMetrics | undefined {
    return this._lastMetrics
  }

  capture(frame: NovaRenderFrame, metrics: NovaRenderMetrics): void {
    this._lastFrame = frame
    this._lastMetrics = metrics
  }
}

export interface NovaMetricsSnapshot {
  rFps: number
  fps: number
  ups: number
  last: number
  idle: number
}

export class NovaMetrics {
  private _rafId = 0
  private _rafLastAt = 0
  private _rafFrames = 0
  private _rFps = 0

  private _drawLastAt = 0
  private _drawWindowAt = 0
  private _drawFrames = 0
  private _fps = 0

  private _frameStartedAt = 0
  private _last = 0

  constructor(private readonly readUps: () => number) {}

  start(): void {
    if (this._rafId || typeof requestAnimationFrame === 'undefined') return
    this._rafId = requestAnimationFrame(this.tickRaf)
  }

  stop(): void {
    if (!this._rafId || typeof cancelAnimationFrame === 'undefined') return
    cancelAnimationFrame(this._rafId)
    this._rafId = 0
  }

  markFrameStart(now = performance.now()): void {
    this._frameStartedAt = now
  }

  markFrameEnd(now = performance.now()): void {
    if (!this._frameStartedAt) return
    this._last = now - this._frameStartedAt
  }

  markDraw(now = performance.now()): void {
    this._drawLastAt = now
    if (!this._drawWindowAt) this._drawWindowAt = now

    this._drawFrames += 1

    const elapsed = now - this._drawWindowAt
    if (elapsed >= 1000) {
      this._fps = Math.round((this._drawFrames * 1000) / elapsed)
      this._drawFrames = 0
      this._drawWindowAt = now
    }
  }

  snapshot(now = performance.now()): NovaMetricsSnapshot {
    const idle = this._drawLastAt ? now - this._drawLastAt : 0

    return {
      rFps: this._rFps,
      fps: idle > 1000 ? 0 : this._fps,
      ups: this.readUps(),
      last: this._last,
      idle,
    }
  }

  private tickRaf = (now: number): void => {
    if (!this._rafLastAt) this._rafLastAt = now

    this._rafFrames += 1

    const elapsed = now - this._rafLastAt
    if (elapsed >= 1000) {
      this._rFps = Math.round((this._rafFrames * 1000) / elapsed)
      this._rafFrames = 0
      this._rafLastAt = now
    }

    this._rafId = requestAnimationFrame(this.tickRaf)
  }
}

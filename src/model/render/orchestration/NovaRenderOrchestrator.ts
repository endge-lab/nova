import type { EventList } from '@endge/utils'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaRenderBackend } from '@/model/render/backends/NovaRenderBackend'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'

/**
 * Coordinates compile/replay of logical surfaces into one root backend pass.
 */
export class NovaRenderOrchestrator<E extends EventList = EventList> {
  private readonly _frames = new WeakMap<NovaSurface<E>, NovaRenderFrame>()
  private _rootClears = 0

  /**
   * Creates orchestrator for a single app-level backend.
   */
  constructor(private readonly _backend: NovaRenderBackend) {}

  /**
   * Renders ordered logical surfaces into the root target.
   */
  render(surfaces: Array<NovaSurface<E>>, dirtySurfaces: ReadonlySet<NovaSurface<E>>): void {
    if (surfaces.length === 0) {
      this._backend.clearRoot()
      this._rootClears += 1
      return
    }

    this._backend.resize?.()
    this._backend.clearRoot()
    this._rootClears += 1

    for (const surface of surfaces) {
      const previousFrame = this._frames.get(surface)
      const needsCompile = dirtySurfaces.has(surface) || !previousFrame || surface.renderFrameDirty
      const frame = needsCompile ? surface.compileRenderFrame() : previousFrame
      this._frames.set(surface, frame)
      const metrics = this._backend.renderFrame(frame)
      surface.setRenderMetrics(this.mergeMetrics(frame.metrics, metrics))
    }
  }

  /**
   * Drops retained frame for a destroyed surface.
   */
  deleteSurface(surface: NovaSurface<E>): void {
    this._frames.delete(surface)
  }

  /**
   * Returns root clear count for tests and diagnostics.
   */
  get rootClears(): number {
    return this._rootClears
  }

  /**
   * Keeps compiler metrics when backend returns draw metrics.
   */
  private mergeMetrics(compiler: NovaRenderMetrics, backend: NovaRenderMetrics): NovaRenderMetrics {
    return {
      ...compiler,
      ...backend,
      compilerMs: compiler.compilerMs,
      commands: compiler.commands,
      items: compiler.items,
      groups: compiler.groups,
    }
  }
}

import type { EventList } from '@endge/utils'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'

/**
 * Координирует compile/replay логических surfaces в один root backend pass.
 */
export class NovaRenderOrchestrator<E extends EventList = EventList> {
  private readonly _frames = new WeakMap<NovaSurface<E>, NovaRenderFrame>()
  private _rootClears = 0

  /**
   * Создает orchestrator для единственного app-level backend.
   */
  constructor(private readonly _backend: NovaRenderBackend) {}

  /**
   * Рендерит упорядоченные логические surfaces в root target.
   */
  render(surfaces: Array<NovaSurface<E>>, _dirtySurfaces: ReadonlySet<NovaSurface<E>>): void {
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
      const needsCompile = !previousFrame || _dirtySurfaces.has(surface) || surface.renderFrameDirty
      const frame = needsCompile ? surface.compileRenderFrame() : previousFrame
      this._frames.set(surface, frame)
      const metrics = this._backend.renderFrame(frame)
      surface.setRenderMetrics(this.mergeMetrics(frame.metrics, metrics))
    }
  }

  /**
   * Удаляет retained frame уничтоженного surface.
   */
  deleteSurface(surface: NovaSurface<E>): void {
    this._frames.delete(surface)
  }

  /**
   * Возвращает количество root clear для тестов и diagnostics.
   */
  get rootClears(): number {
    return this._rootClears
  }

  /**
   * Сохраняет compiler metrics, когда backend возвращает draw metrics.
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

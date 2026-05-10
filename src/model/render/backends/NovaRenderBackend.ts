import type { NovaRendererConfig, NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { RendererType, NovaRendererCanvas } from '@/domain/types/renderer.types'

/**
 * Backend executor for compiled Nova frames.
 */
export interface NovaRenderBackend {
  readonly id: string
  readonly type: RendererType
  readonly novaCanvas: NovaRendererCanvas
  readonly diagnostics?: unknown

  renderFrame(frame: NovaRenderFrame): NovaRenderMetrics
  clearRoot(): void
  resize?(): void
  configure?(config: NovaRendererConfig): void
  destroy(): void
}

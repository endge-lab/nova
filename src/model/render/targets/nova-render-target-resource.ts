import type { NovaRenderTarget } from '@/domain/types/rendering/index'

/**
 * Физический ресурс backend за логическим render target.
 */
export interface NovaRenderTargetResource<TTexture = unknown, TFramebuffer = unknown> {
  readonly target: NovaRenderTarget
  readonly texture?: TTexture
  readonly framebuffer?: TFramebuffer
  readonly canvas?: HTMLCanvasElement | OffscreenCanvas
  readonly context?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null

  resize(width: number, height: number, dpr: number): void
  clear(): void
  destroy(): void
}

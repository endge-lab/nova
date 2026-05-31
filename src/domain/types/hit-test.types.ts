import type { NovaBounds } from '@/domain/types/renderer.types'

/**
 * Описывает контекст shape-level hit-test для Nova node.
 */
export interface NovaHitTestContext<TNode = unknown> {
  node: TNode
  worldX: number
  worldY: number
  localX: number
  localY: number
  bounds: NovaBounds
}

/**
 * Описывает пользовательский shape-level hit-test handler.
 */
export type NovaHitTestHandler<TNode = unknown> = (context: NovaHitTestContext<TNode>) => boolean

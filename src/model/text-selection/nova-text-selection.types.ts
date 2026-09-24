import type { NovaRectLike, NovaTextRange } from '@/model/input/nova-input.types'

export type NovaTextSelectionMode = 'explicit' | 'all-text'
export type NovaTextSelectionGranularity = 'text' | 'word' | 'line' | 'block'
export type NovaTextSelectionClipboardMode = 'plain' | 'rich' | 'contextual'

export interface NovaTextSelectionOptions {
  enabled?: boolean
  mode?: NovaTextSelectionMode
  copy?: boolean
  drag?: boolean
  doubleClick?: 'word' | 'block'
  tripleClick?: 'line' | 'paragraph'
  granularity?: NovaTextSelectionGranularity
  clipboard?: NovaTextSelectionClipboardMode
  selectionColor?: string
}

export interface NovaTextSelectionTarget<TContext = unknown> {
  id: string
  text: string
  rect: NovaRectLike
  selectable?: boolean
  copyable?: boolean
  scope?: string
  ownerId?: string
  zIndex?: number
  order?: number
  context?: TContext
  copyText?: string
}

export interface NovaTextSelectionResolvedTarget<TContext = unknown> extends NovaTextSelectionTarget<TContext> {
  selectable: boolean
  copyable: boolean
  zIndex: number
  order: number
}

export interface NovaTextSelectionAnchor {
  targetId: string
  offset: number
}

export interface NovaTextSelectionRange<TContext = unknown> {
  target: NovaTextSelectionResolvedTarget<TContext>
  range: NovaTextRange
}

export interface NovaTextSelectionState<TContext = unknown> {
  active: boolean
  dragging: boolean
  anchor: NovaTextSelectionAnchor | null
  focus: NovaTextSelectionAnchor | null
  ranges: Array<NovaTextSelectionRange<TContext>>
  text: string
}

export interface NovaTextSelectionHit<TContext = unknown> {
  target: NovaTextSelectionResolvedTarget<TContext>
  offset: number
}

import type { RaphFrameContext } from '@endge/raph'
import type { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает тип NovaMotionTarget.
 */
export type NovaMotionTarget = NovaNode<any> | NovaComponentNode<any, any, any, any, any>
/**
 * Описывает тип NovaMotionValue.
 */
export type NovaMotionValue = number | string | boolean | undefined
/**
 * Описывает тип NovaMotionPatch.
 */
export type NovaMotionPatch = Record<string, NovaMotionValue>
/**
 * Описывает тип NovaMotionEasingName.
 */
export type NovaMotionEasingName =
  | 'linear'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'

/**
 * Описывает тип NovaMotionPlaybackState.
 */
export type NovaMotionPlaybackState = 'idle' | 'running' | 'paused' | 'finished' | 'cancelled'

/**
 * Описывает контракт NovaMotionOptions.
 */
export interface NovaMotionOptions {
  duration?: number
  delay?: number
  easing?: NovaMotionEasingName | ((t: number) => number)
  repeat?: number
  yoyo?: boolean
  overwrite?: boolean
  autoplay?: boolean
  id?: string
}

/**
 * Описывает контракт NovaMotionTweenOptions.
 */
export interface NovaMotionTweenOptions extends NovaMotionOptions {
  from?: NovaMotionPatch
}

/**
 * Описывает тип NovaMotionKeyframe.
 */
export type NovaMotionKeyframe = NovaMotionPatch & {
  at?: number
  easing?: NovaMotionOptions['easing']
}

/**
 * Описывает контракт NovaMotionTrack.
 */
export interface NovaMotionTrack {
  target: NovaMotionTarget
  at?: number
  keyframes: NovaMotionKeyframe[]
  easing?: NovaMotionOptions['easing']
  duration?: number
}

/**
 * Описывает контракт NovaMotionSequenceItem.
 */
export interface NovaMotionSequenceItem {
  target: NovaMotionTarget
  patch: NovaMotionPatch
  duration?: number
  delay?: number
  easing?: NovaMotionOptions['easing']
}

/**
 * Описывает контракт NovaMotionStaggerOptions.
 */
export interface NovaMotionStaggerOptions {
  targets: NovaMotionTarget[]
  patch: NovaMotionPatch
  each: number
  duration?: number
  easing?: NovaMotionOptions['easing']
}

/**
 * Описывает контракт NovaMotionTimelineOptions.
 */
export interface NovaMotionTimelineOptions extends NovaMotionOptions {
  tracks?: NovaMotionTrack[]
  sequence?: NovaMotionSequenceItem[]
  stagger?: NovaMotionStaggerOptions
}

/**
 * Описывает контракт NovaMotionPlayback.
 */
export interface NovaMotionPlayback {
  readonly id?: string
  readonly state: NovaMotionPlaybackState
  play(): void
  pause(): void
  resume(): void
  cancel(): void
  seek(time: number): void
}

/**
 * Описывает контракт NovaMotionTickContext.
 */
export interface NovaMotionTickContext extends RaphFrameContext {}

/**
 * Описывает контракт NovaMotionSegment.
 */
export interface NovaMotionSegment {
  id?: string
  playback: NovaMotionPlayback
  target: NovaMotionTarget
  key: string
  from: NovaMotionValue
  to: NovaMotionValue
  startAt: number
  duration: number
  easing: NovaMotionOptions['easing']
}

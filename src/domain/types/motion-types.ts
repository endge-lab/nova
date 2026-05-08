import type { RaphFrameContext } from '@endge/raph'
import type { NovaComponentNode } from '@/domain/entities/core/NovaComponentNode'
import type { NovaNode } from '@/domain/entities/core/NovaNode'

export type NovaMotionTarget = NovaNode<any> | NovaComponentNode<any, any, any, any, any>
export type NovaMotionValue = number | string | boolean | undefined
export type NovaMotionPatch = Record<string, NovaMotionValue>
export type NovaMotionEasingName =
  | 'linear'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'

export type NovaMotionPlaybackState = 'idle' | 'running' | 'paused' | 'finished' | 'cancelled'

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

export interface NovaMotionTweenOptions extends NovaMotionOptions {
  from?: NovaMotionPatch
}

export type NovaMotionKeyframe = NovaMotionPatch & {
  at?: number
  easing?: NovaMotionOptions['easing']
}

export interface NovaMotionTrack {
  target: NovaMotionTarget
  at?: number
  keyframes: NovaMotionKeyframe[]
  easing?: NovaMotionOptions['easing']
  duration?: number
}

export interface NovaMotionSequenceItem {
  target: NovaMotionTarget
  patch: NovaMotionPatch
  duration?: number
  delay?: number
  easing?: NovaMotionOptions['easing']
}

export interface NovaMotionStaggerOptions {
  targets: NovaMotionTarget[]
  patch: NovaMotionPatch
  each: number
  duration?: number
  easing?: NovaMotionOptions['easing']
}

export interface NovaMotionTimelineOptions extends NovaMotionOptions {
  tracks?: NovaMotionTrack[]
  sequence?: NovaMotionSequenceItem[]
  stagger?: NovaMotionStaggerOptions
}

export interface NovaMotionPlayback {
  readonly id?: string
  readonly state: NovaMotionPlaybackState
  play(): void
  pause(): void
  resume(): void
  cancel(): void
  seek(time: number): void
}

export interface NovaMotionTickContext extends RaphFrameContext {}

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

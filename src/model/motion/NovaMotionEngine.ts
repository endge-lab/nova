import type { RaphLoopLease } from '@endge/raph'
import type { NovaApp } from '@/model/app/NovaApp'
import { NovaComponentNode } from '@/model/core/NovaComponentNode'
import { NovaNode } from '@/model/core/NovaNode'
import { clampMotionProgress, resolveNovaMotionEasing } from '@/model/motion/NovaMotionEasing'
import { interpolateNovaMotionValue } from '@/model/motion/NovaMotionInterpolation'
import {
  runNovaMotionPattern,
  runNovaMotionPreset,
  type NovaMotionPatternName,
  type NovaMotionPatternOptions,
  type NovaMotionPresetName,
  type NovaMotionPresetOptions,
} from '@/model/motion/NovaMotionPresets'
import { compileNovaMotionTimeline } from '@/model/motion/NovaMotionTimeline'
import type {
  NovaMotionOptions,
  NovaMotionPatch,
  NovaMotionPlayback,
  NovaMotionPlaybackState,
  NovaMotionSegment,
  NovaMotionTarget,
  NovaMotionTickContext,
  NovaMotionTimelineOptions,
  NovaMotionTweenOptions,
  NovaMotionValue,
} from '@/domain/types/motion-types'

const NODE_MOTION_KEYS = new Set([
  'x',
  'y',
  'width',
  'height',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'visible',
])

const TRANSFORM_KEYS = new Set(['x', 'y', 'scaleX', 'scaleY', 'rotation'])
const SIZE_KEYS = new Set(['width', 'height'])
const VISUAL_KEYS = new Set(['opacity', 'visible'])

export class NovaMotionEngine {
  private readonly playbacks = new Set<NovaMotionPlaybackController>()
  private lease: RaphLoopLease | null = null

  constructor(private readonly app: NovaApp<any>) {}

  to(
    target: NovaMotionTarget,
    patch: NovaMotionPatch,
    options: NovaMotionTweenOptions = {},
  ): NovaMotionPlayback {
    const playback = new NovaMotionPlaybackController(this, options)
    const delay = options.delay ?? 0
    const duration = Math.max(0, options.duration ?? 300)
    const segments: NovaMotionSegment[] = []

    for (const [key, to] of Object.entries(patch)) {
      segments.push({
        id: options.id,
        playback,
        target,
        key,
        from: options.from?.[key] ?? this.readValue(target, key),
        to,
        startAt: delay,
        duration,
        easing: options.easing,
      })
    }

    this.addPlayback(playback, segments, options)
    if (options.autoplay !== false) playback.play()
    return playback
  }

  timeline(options: NovaMotionTimelineOptions): NovaMotionPlayback {
    const playback = new NovaMotionPlaybackController(this, options)
    const segments = compileNovaMotionTimeline(playback, options, (target, key) => this.readValue(target, key))
    this.addPlayback(playback, segments, options)
    if (options.autoplay !== false) playback.play()
    return playback
  }

  preset(
    target: NovaMotionTarget,
    name: NovaMotionPresetName,
    options: NovaMotionPresetOptions = {},
  ): NovaMotionPlayback {
    return runNovaMotionPreset(this, target, name, options)
  }

  pattern(
    targets: NovaMotionTarget[],
    name: NovaMotionPatternName,
    options: NovaMotionPatternOptions = {},
  ): NovaMotionPlayback {
    return runNovaMotionPattern(this, targets, name, options)
  }

  cancel(target?: NovaMotionTarget): void {
    for (const playback of [...this.playbacks]) {
      if (!target || playback.hasTarget(target)) {
        playback.cancel()
      }
    }
    this.syncLoopLease()
  }

  pauseAll(): void {
    for (const playback of this.playbacks) {
      playback.pause()
    }
    this.syncLoopLease()
  }

  resumeAll(): void {
    for (const playback of this.playbacks) {
      playback.resume()
    }
    this.syncLoopLease()
  }

  tick(frame: NovaMotionTickContext): void {
    if (this.playbacks.size === 0) {
      this.syncLoopLease()
      return
    }

    const patches = new Map<NovaMotionTarget, NovaMotionPatch>()

    for (const playback of [...this.playbacks]) {
      playback.tick(frame.now, patches)
      if (playback.state === 'finished' || playback.state === 'cancelled') {
        this.playbacks.delete(playback)
      }
    }

    for (const [target, patch] of patches) {
      this.applyPatch(target, patch)
    }

    this.syncLoopLease()
  }

  destroy(): void {
    for (const playback of [...this.playbacks]) {
      playback.cancel()
    }
    this.playbacks.clear()
    if (this.lease) {
      this.lease.release()
      this.lease = null
    }
  }

  _activate(playback: NovaMotionPlaybackController): void {
    this.playbacks.add(playback)
    this.syncLoopLease()
  }

  _deactivate(playback: NovaMotionPlaybackController): void {
    this.playbacks.delete(playback)
    this.syncLoopLease()
  }

  private addPlayback(
    playback: NovaMotionPlaybackController,
    segments: NovaMotionSegment[],
    options: NovaMotionOptions,
  ): void {
    playback.setSegments(segments)
    if (options.overwrite !== false) {
      this.overwriteSegments(segments)
    }
  }

  private overwriteSegments(nextSegments: NovaMotionSegment[]): void {
    const keys = new Set(nextSegments.map(segment => segmentKey(segment.target, segment.key)))

    for (const playback of [...this.playbacks]) {
      playback.removeSegments(segment => keys.has(segmentKey(segment.target, segment.key)))
      if (playback.empty) playback.cancel()
    }
  }

  private readValue(target: NovaMotionTarget, key: string): NovaMotionValue {
    if (target instanceof NovaComponentNode && !NODE_MOTION_KEYS.has(key)) {
      return target.getProps()[key]
    }

    const directValue = (target as any)[key]
    if (directValue !== undefined) return directValue

    if (typeof (target as any).get === 'function') {
      return (target as any).get(key)
    }

    return undefined
  }

  private applyPatch(target: NovaMotionTarget, patch: NovaMotionPatch): void {
    const nodePatch: NovaMotionPatch = {}
    const componentPatch: NovaMotionPatch = {}

    for (const [key, value] of Object.entries(patch)) {
      if (target instanceof NovaComponentNode && !NODE_MOTION_KEYS.has(key)) {
        componentPatch[key] = value
      } else {
        nodePatch[key] = value
      }
    }

    if (Object.keys(componentPatch).length > 0 && target instanceof NovaComponentNode) {
      target.setProps(componentPatch)
    }

    if (Object.keys(nodePatch).length > 0 && target instanceof NovaNode) {
      for (const [key, value] of Object.entries(nodePatch)) {
        if (key in target) {
          ;(target as any)[key] = value
        } else {
          target.options({ [key]: value } as any)
        }
      }
      target.dirty(resolveNodeDirty(nodePatch))
    }
  }

  private syncLoopLease(): void {
    const hasRunning = [...this.playbacks].some(playback => playback.state === 'running')
    if (hasRunning && !this.lease) {
      this.lease = this.app.raph.acquireLoop('nova-motion')
    } else if (!hasRunning && this.lease) {
      this.lease.release()
      this.lease = null
    }
  }
}

class NovaMotionPlaybackController implements NovaMotionPlayback {
  private segments: NovaMotionSegment[] = []
  private startedAt = 0
  private pausedAt = 0
  private seekOffset = 0
  private _state: NovaMotionPlaybackState = 'idle'

  constructor(
    private readonly engine: NovaMotionEngine,
    private readonly options: NovaMotionOptions,
  ) {}

  get id(): string | undefined {
    return this.options.id
  }

  get state(): NovaMotionPlaybackState {
    return this._state
  }

  get empty(): boolean {
    return this.segments.length === 0
  }

  setSegments(segments: NovaMotionSegment[]): void {
    this.segments = segments
  }

  hasTarget(target: NovaMotionTarget): boolean {
    return this.segments.some(segment => segment.target === target)
  }

  removeSegments(predicate: (segment: NovaMotionSegment) => boolean): void {
    this.segments = this.segments.filter(segment => !predicate(segment))
  }

  play(): void {
    this.startedAt = performance.now()
    this.pausedAt = 0
    this.seekOffset = 0
    this._state = 'running'
    this.engine._activate(this)
  }

  pause(): void {
    if (this._state !== 'running') return
    this.pausedAt = performance.now()
    this._state = 'paused'
  }

  resume(): void {
    if (this._state !== 'paused') return
    this.startedAt += performance.now() - this.pausedAt
    this.pausedAt = 0
    this._state = 'running'
    this.engine._activate(this)
  }

  cancel(): void {
    if (this._state === 'cancelled') return
    this._state = 'cancelled'
    this.engine._deactivate(this)
  }

  seek(time: number): void {
    this.seekOffset = Math.max(0, time)
    if (this._state === 'idle') {
      this._state = 'paused'
    }
  }

  tick(now: number, patches: Map<NovaMotionTarget, NovaMotionPatch>): void {
    if (this._state !== 'running') return
    if (this.segments.length === 0) {
      this._state = 'finished'
      return
    }

    const duration = this.duration
    const repeat = this.options.repeat ?? 0
    const rawTime = Math.max(0, now - this.startedAt + this.seekOffset)
    const totalDuration = repeat === Infinity ? Infinity : duration * (repeat + 1)

    if (rawTime >= totalDuration) {
      this.applyAt(duration, patches)
      this._state = 'finished'
      return
    }

    const cycle = duration === 0 ? 0 : Math.floor(rawTime / duration)
    let localTime = duration === 0 ? duration : rawTime % duration
    if (this.options.yoyo && cycle % 2 === 1) {
      localTime = duration - localTime
    }

    this.applyAt(localTime, patches)
  }

  private applyAt(time: number, patches: Map<NovaMotionTarget, NovaMotionPatch>): void {
    for (const segment of this.segments) {
      const segmentEnd = segment.startAt + segment.duration
      if (time < segment.startAt) continue
      if (time > segmentEnd) {
        appendPatch(patches, segment.target, segment.key, segment.to)
        continue
      }

      const rawProgress = segment.duration === 0 ? 1 : (time - segment.startAt) / segment.duration
      const eased = resolveNovaMotionEasing(segment.easing)(clampMotionProgress(rawProgress))
      appendPatch(
        patches,
        segment.target,
        segment.key,
        interpolateNovaMotionValue(segment.from, segment.to, eased),
      )
    }
  }

  private get duration(): number {
    return Math.max(0, ...this.segments.map(segment => segment.startAt + segment.duration))
  }
}

function appendPatch(
  patches: Map<NovaMotionTarget, NovaMotionPatch>,
  target: NovaMotionTarget,
  key: string,
  value: NovaMotionValue,
): void {
  let patch = patches.get(target)
  if (!patch) {
    patch = {}
    patches.set(target, patch)
  }
  patch[key] = value
}

function resolveNodeDirty(patch: NovaMotionPatch): { matrix?: boolean; update?: boolean; render?: boolean } {
  const keys = Object.keys(patch)
  return {
    matrix: keys.some(key => TRANSFORM_KEYS.has(key) || SIZE_KEYS.has(key)),
    render: keys.some(key => SIZE_KEYS.has(key) || VISUAL_KEYS.has(key) || !TRANSFORM_KEYS.has(key)),
  }
}

function segmentKey(target: NovaMotionTarget, key: string): string {
  return `${(target as any).id ?? 'target'}:${key}`
}

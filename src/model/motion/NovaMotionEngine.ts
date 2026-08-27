import type { RaphLoopLease } from '@endge/raph'
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
} from '@/domain/types/motion.types'
import type { NovaMotionPatternName, NovaMotionPatternOptions, NovaMotionPresetName, NovaMotionPresetOptions } from '@/model/motion/nova-motion-presets'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import { clampMotionProgress, resolveNovaMotionEasing } from '@/model/motion/nova-motion-easing'
import { interpolateNovaMotionValue } from '@/model/motion/nova-motion-interpolation'
import {

  runNovaMotionPattern,
  runNovaMotionPreset,
} from '@/model/motion/nova-motion-presets'
import { compileNovaMotionTimeline } from '@/model/motion/nova-motion-timeline'
import { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

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

/**
 * Управляет playback state одного motion timeline или tween.
 */
class NovaMotionPlaybackController implements NovaMotionPlayback {
  private _segments: Array<NovaMotionSegment> = []
  private _startedAt = 0
  private _pausedAt = 0
  private _seekOffset = 0
  private _state: NovaMotionPlaybackState = 'idle'

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _engine: NovaMotionEngine,
    private readonly _options: NovaMotionOptions,
  ) {}

  /**
   * Возвращает id.
   */
  get id(): string | undefined {
    return this._options.id
  }

  /**
   * Возвращает state.
   */
  get state(): NovaMotionPlaybackState {
    return this._state
  }

  /**
   * Возвращает empty.
   */
  get empty(): boolean {
    return this._segments.length === 0
  }

  /**
   * Обновляет segments.
   */
  setSegments(segments: Array<NovaMotionSegment>): void {
    this._segments = segments
  }

  /**
   * Проверяет наличие target.
   */
  hasTarget(target: NovaMotionTarget): boolean {
    return this._segments.some(segment => segment.target === target)
  }

  /**
   * Удаляет segments.
   */
  removeSegments(predicate: (segment: NovaMotionSegment) => boolean): void {
    this._segments = this._segments.filter(segment => !predicate(segment))
  }

  /**
   * Выполняет внутреннюю операцию play.
   */
  play(): void {
    this._startedAt = performance.now()
    this._pausedAt = 0
    this._seekOffset = 0
    this._state = 'running'
    this._engine._activate(this)
  }

  /**
   * Выполняет внутреннюю операцию pause.
   */
  pause(): void {
    if (this._state !== 'running') {
      return
    }
    this._pausedAt = performance.now()
    this._state = 'paused'
  }

  /**
   * Выполняет внутреннюю операцию resume.
   */
  resume(): void {
    if (this._state !== 'paused') {
      return
    }
    this._startedAt += performance.now() - this._pausedAt
    this._pausedAt = 0
    this._state = 'running'
    this._engine._activate(this)
  }

  /**
   * Выполняет внутреннюю операцию cancel.
   */
  cancel(): void {
    if (this._state === 'cancelled') {
      return
    }
    this._state = 'cancelled'
    this._engine._deactivate(this)
  }

  /**
   * Выполняет внутреннюю операцию seek.
   */
  seek(time: number): void {
    this._seekOffset = Math.max(0, time)
    if (this._state === 'idle') {
      this._state = 'paused'
    }
  }

  /**
   * Выполняет один tick runtime-обработки.
   */
  tick(now: number, patches: Map<NovaMotionTarget, NovaMotionPatch>): void {
    if (this._state !== 'running') {
      return
    }
    if (this._segments.length === 0) {
      this._state = 'finished'
      return
    }

    const duration = this._duration
    const repeat = this._options.repeat ?? 0
    const rawTime = Math.max(0, now - this._startedAt + this._seekOffset)
    const totalDuration = repeat === Infinity ? Infinity : duration * (repeat + 1)

    if (rawTime >= totalDuration) {
      this._applyAt(duration, patches)
      this._state = 'finished'
      return
    }

    const cycle = duration === 0 ? 0 : Math.floor(rawTime / duration)
    let localTime = duration === 0 ? duration : rawTime % duration
    if (this._options.yoyo && cycle % 2 === 1) {
      localTime = duration - localTime
    }

    this._applyAt(localTime, patches)
  }

  /**
   * Выполняет внутреннюю операцию apply at.
   */
  private _applyAt(time: number, patches: Map<NovaMotionTarget, NovaMotionPatch>): void {
    for (const segment of this._segments) {
      const segmentEnd = segment.startAt + segment.duration
      if (time < segment.startAt) {
        continue
      }
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

  /**
   * Возвращает duration.
   */
  private get _duration(): number {
    return Math.max(0, ...this._segments.map(segment => segment.startAt + segment.duration))
  }
}

/**
 * Управляет motion segments, timelines и playback в Nova runtime.
 */
export class NovaMotionEngine {
  private readonly _playbacks = new Set<NovaMotionPlaybackController>()
  private _lease: RaphLoopLease | null = null

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(private readonly _app: NovaApp<any>) {}

  /**
   * Выполняет внутреннюю операцию to.
   */
  to(
    target: NovaMotionTarget,
    patch: NovaMotionPatch,
    options: NovaMotionTweenOptions = {},
  ): NovaMotionPlayback {
    const playback = new NovaMotionPlaybackController(this, options)
    const delay = options.delay ?? 0
    const duration = Math.max(0, options.duration ?? 300)
    const segments: Array<NovaMotionSegment> = []

    for (const [key, to] of Object.entries(patch)) {
      segments.push({
        id: options.id,
        playback,
        target,
        key,
        from: options.from?.[key] ?? this._readValue(target, key),
        to,
        startAt: delay,
        duration,
        easing: options.easing,
      })
    }

    this._addPlayback(playback, segments, options)
    if (options.autoplay !== false) {
      playback.play()
    }
    return playback
  }

  /**
   * Выполняет внутреннюю операцию timeline.
   */
  timeline(options: NovaMotionTimelineOptions): NovaMotionPlayback {
    const playback = new NovaMotionPlaybackController(this, options)
    const segments = compileNovaMotionTimeline(playback, options, (target, key) => this._readValue(target, key))
    this._addPlayback(playback, segments, options)
    if (options.autoplay !== false) {
      playback.play()
    }
    return playback
  }

  /**
   * Выполняет внутреннюю операцию preset.
   */
  preset(
    target: NovaMotionTarget,
    name: NovaMotionPresetName,
    options: NovaMotionPresetOptions = {},
  ): NovaMotionPlayback {
    return runNovaMotionPreset(this, target, name, options)
  }

  /**
   * Выполняет внутреннюю операцию pattern.
   */
  pattern(
    targets: Array<NovaMotionTarget>,
    name: NovaMotionPatternName,
    options: NovaMotionPatternOptions = {},
  ): NovaMotionPlayback {
    return runNovaMotionPattern(this, targets, name, options)
  }

  /**
   * Выполняет внутреннюю операцию cancel.
   */
  cancel(target?: NovaMotionTarget): void {
    for (const playback of [...this._playbacks]) {
      if (!target || playback.hasTarget(target)) {
        playback.cancel()
      }
    }
    this._syncLoopLease()
  }

  /**
   * Выполняет внутреннюю операцию pause all.
   */
  pauseAll(): void {
    for (const playback of this._playbacks) {
      playback.pause()
    }
    this._syncLoopLease()
  }

  /**
   * Выполняет внутреннюю операцию resume all.
   */
  resumeAll(): void {
    for (const playback of this._playbacks) {
      playback.resume()
    }
    this._syncLoopLease()
  }

  /**
   * Выполняет один tick runtime-обработки.
   */
  tick(frame: NovaMotionTickContext): void {
    if (this._playbacks.size === 0) {
      this._syncLoopLease()
      return
    }

    const patches = new Map<NovaMotionTarget, NovaMotionPatch>()

    for (const playback of [...this._playbacks]) {
      playback.tick(frame.now, patches)
      if (playback.state === 'finished' || playback.state === 'cancelled') {
        this._playbacks.delete(playback)
      }
    }

    for (const [target, patch] of patches) {
      this._applyPatch(target, patch)
    }

    this._syncLoopLease()
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    for (const playback of [...this._playbacks]) {
      playback.cancel()
    }
    this._playbacks.clear()
    if (this._lease) {
      this._lease.release()
      this._lease = null
    }
  }

  /**
   * Выполняет внутреннюю операцию activate.
   */
  _activate(playback: NovaMotionPlaybackController): void {
    this._playbacks.add(playback)
    this._syncLoopLease()
  }

  /**
   * Выполняет внутреннюю операцию deactivate.
   */
  _deactivate(playback: NovaMotionPlaybackController): void {
    this._playbacks.delete(playback)
    this._syncLoopLease()
  }

  /**
   * Добавляет playback.
   */
  private _addPlayback(
    playback: NovaMotionPlaybackController,
    segments: Array<NovaMotionSegment>,
    options: NovaMotionOptions,
  ): void {
    playback.setSegments(segments)
    if (options.overwrite !== false) {
      this._overwriteSegments(segments)
    }
  }

  /**
   * Выполняет внутреннюю операцию overwrite segments.
   */
  private _overwriteSegments(nextSegments: Array<NovaMotionSegment>): void {
    const keys = new Set(nextSegments.map(segment => segmentKey(segment.target, segment.key)))

    for (const playback of [...this._playbacks]) {
      playback.removeSegments(segment => keys.has(segmentKey(segment.target, segment.key)))
      if (playback.empty) {
        playback.cancel()
      }
    }
  }

  /**
   * Читает value.
   */
  private _readValue(target: NovaMotionTarget, key: string): NovaMotionValue {
    if (target instanceof NovaComponentNode && !NODE_MOTION_KEYS.has(key)) {
      return target.getProps()[key]
    }

    const directValue = (target as any)[key]
    if (directValue !== undefined) {
      return directValue
    }

    if (typeof (target as any).get === 'function') {
      return (target as any).get(key)
    }

    return undefined
  }

  /**
   * Выполняет внутреннюю операцию apply patch.
   */
  private _applyPatch(target: NovaMotionTarget, patch: NovaMotionPatch): void {
    const nodePatch: NovaMotionPatch = {}
    const componentPatch: NovaMotionPatch = {}

    for (const [key, value] of Object.entries(patch)) {
      if (target instanceof NovaComponentNode && !NODE_MOTION_KEYS.has(key)) {
        componentPatch[key] = value
      }
      else {
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
        }
        else {
          target.options({ [key]: value } as any)
        }
      }
      target.dirty(resolveNodeDirty(nodePatch))
    }
  }

  /**
   * Выполняет внутреннюю операцию sync loop lease.
   */
  private _syncLoopLease(): void {
    const hasRunning = [...this._playbacks].some(playback => playback.state === 'running')
    if (hasRunning && !this._lease) {
      this._lease = this._app.raph.acquireLoop('nova-motion')
    }
    else if (!hasRunning && this._lease) {
      this._lease.release()
      this._lease = null
    }
  }
}
/**
 * Добавляет patch.
 */
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

/**
 * Вычисляет node dirty.
 */
function resolveNodeDirty(patch: NovaMotionPatch): { matrix?: boolean, update?: boolean, render?: boolean } {
  const keys = Object.keys(patch)
  return {
    matrix: keys.some(key => TRANSFORM_KEYS.has(key) || SIZE_KEYS.has(key)),
    render: keys.some(key => SIZE_KEYS.has(key) || VISUAL_KEYS.has(key) || !TRANSFORM_KEYS.has(key)),
  }
}

/**
 * Выполняет внутреннюю операцию segment key.
 */
function segmentKey(target: NovaMotionTarget, key: string): string {
  return `${(target as any).id ?? 'target'}:${key}`
}

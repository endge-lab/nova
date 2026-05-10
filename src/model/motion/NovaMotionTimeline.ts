import type {
  NovaMotionPatch,
  NovaMotionSegment,
  NovaMotionTimelineOptions,
  NovaMotionValue,
  NovaMotionPlayback,
} from '@/domain/types/motion.types'

/**
 * Компилирует nova motion timeline.
 */
export function compileNovaMotionTimeline(
  playback: NovaMotionPlayback,
  options: NovaMotionTimelineOptions,
  readValue: (target: NovaMotionSegment['target'], key: string) => NovaMotionValue,
): NovaMotionSegment[] {
  const segments: NovaMotionSegment[] = []

  for (const track of options.tracks ?? []) {
    const baseAt = track.at ?? 0
    const sorted = [...track.keyframes].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    if (sorted.length === 0) continue

    let previousAt = 0
    let previousPatch: NovaMotionPatch = {}

    for (let index = 0; index < sorted.length; index++) {
      const keyframe = sorted[index]
      const currentAt = keyframe.at ?? (index === 0 ? 0 : previousAt + (track.duration ?? options.duration ?? 300))
      const patch = stripKeyframeMeta(keyframe)

      if (index === 0) {
        previousAt = currentAt
        previousPatch = patch
        continue
      }

      const keys = new Set([...Object.keys(previousPatch), ...Object.keys(patch)])
      for (const key of keys) {
        if (!(key in patch)) continue
        segments.push({
          id: options.id,
          playback,
          target: track.target,
          key,
          from: previousPatch[key] ?? readValue(track.target, key),
          to: patch[key],
          startAt: baseAt + previousAt,
          duration: Math.max(0, currentAt - previousAt),
          easing: keyframe.easing ?? track.easing ?? options.easing,
        })
      }

      previousAt = currentAt
      previousPatch = patch
    }
  }

  let sequenceAt = 0
  for (const item of options.sequence ?? []) {
    const delay = item.delay ?? 0
    const duration = item.duration ?? options.duration ?? 300
    for (const [key, to] of Object.entries(item.patch)) {
      segments.push({
        id: options.id,
        playback,
        target: item.target,
        key,
        from: readValue(item.target, key),
        to,
        startAt: sequenceAt + delay,
        duration,
        easing: item.easing ?? options.easing,
      })
    }
    sequenceAt += delay + duration
  }

  if (options.stagger) {
    const duration = options.stagger.duration ?? options.duration ?? 300
    options.stagger.targets.forEach((target, index) => {
      for (const [key, to] of Object.entries(options.stagger!.patch)) {
        segments.push({
          id: options.id,
          playback,
          target,
          key,
          from: readValue(target, key),
          to,
          startAt: index * options.stagger!.each,
          duration,
          easing: options.stagger!.easing ?? options.easing,
        })
      }
    })
  }

  return segments.sort((a, b) => a.startAt - b.startAt)
}

/**
 * Выполняет внутреннюю операцию strip keyframe meta.
 */
function stripKeyframeMeta(keyframe: Record<string, any>): NovaMotionPatch {
  const { at: _at, easing: _easing, ...patch } = keyframe
  return patch
}

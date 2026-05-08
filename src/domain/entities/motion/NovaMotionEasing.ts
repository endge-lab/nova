import type { NovaMotionEasingName, NovaMotionOptions } from '@/domain/types/motion-types'

export const NOVA_MOTION_EASING: Record<NovaMotionEasingName, (t: number) => number> = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2,
  inCubic: t => t * t * t,
  outCubic: t => 1 - (1 - t) ** 3,
  inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2,
}

export function resolveNovaMotionEasing(easing: NovaMotionOptions['easing']): (t: number) => number {
  if (typeof easing === 'function') return easing
  return NOVA_MOTION_EASING[easing ?? 'linear'] ?? NOVA_MOTION_EASING.linear
}

export function clampMotionProgress(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

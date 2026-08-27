import type { NovaMotionValue } from '@/domain/types/motion.types'

/**
 * Описывает контракт RgbaColor.
 */
interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Выполняет публичную операцию interpolate nova motion value.
 */
export function interpolateNovaMotionValue(
  from: NovaMotionValue,
  to: NovaMotionValue,
  progress: number,
): NovaMotionValue {
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * progress
  }

  const fromColor = parseColor(from)
  const toColor = parseColor(to)
  if (fromColor && toColor) {
    return formatRgba({
      r: fromColor.r + (toColor.r - fromColor.r) * progress,
      g: fromColor.g + (toColor.g - fromColor.g) * progress,
      b: fromColor.b + (toColor.b - fromColor.b) * progress,
      a: fromColor.a + (toColor.a - fromColor.a) * progress,
    })
  }

  return progress >= 1 ? to : from
}

/**
 * Парсит color.
 */
export function parseColor(value: unknown): RgbaColor | null {
  if (typeof value !== 'string') {
    return null
  }
  const color = value.trim()

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
      a: 1,
    }
  }

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return {
      r: Number.parseInt(color.slice(1, 3), 16),
      g: Number.parseInt(color.slice(3, 5), 16),
      b: Number.parseInt(color.slice(5, 7), 16),
      a: 1,
    }
  }

  const rgb = color.match(/^rgba?\(([^)]+)\)$/i)
  if (!rgb) {
    return null
  }

  const parts = rgb[1].split(',').map(part => part.trim())
  if (parts.length < 3) {
    return null
  }

  const r = Number(parts[0])
  const g = Number(parts[1])
  const b = Number(parts[2])
  const a = parts[3] === undefined ? 1 : Number(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) {
    return null
  }

  return { r, g, b, a }
}

/**
 * Форматирует rgba.
 */
function formatRgba(color: RgbaColor): string {
  const r = Math.round(clamp(color.r, 0, 255))
  const g = Math.round(clamp(color.g, 0, 255))
  const b = Math.round(clamp(color.b, 0, 255))
  const a = clamp(color.a, 0, 1)
  if (a >= 1) {
    return `rgb(${r}, ${g}, ${b})`
  }
  return `rgba(${r}, ${g}, ${b}, ${roundAlpha(a)})`
}

/**
 * Выполняет внутреннюю операцию clamp.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Выполняет внутреннюю операцию round alpha.
 */
function roundAlpha(value: number): number {
  return Math.round(value * 1000) / 1000
}

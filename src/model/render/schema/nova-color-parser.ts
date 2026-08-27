const NAMED_COLORS: Record<string, number> = {
  black: 0x000000FF,
  white: 0xFFFFFFFF,
  red: 0xFF0000FF,
  green: 0x008000FF,
  blue: 0x0000FFFF,
  transparent: 0x00000000,
}

/**
 * Описывает контракт NovaParsedColor.
 */
export interface NovaParsedColor {
  r: number
  g: number
  b: number
  a: number
  packed: number
}

/**
 * Парсит nova color.
 */
export function parseNovaColor(input: string | undefined, fallback = 0x00000000): NovaParsedColor {
  const packed = parseNovaColorPacked(input, fallback)
  return {
    r: ((packed >>> 24) & 0xFF) / 255,
    g: ((packed >>> 16) & 0xFF) / 255,
    b: ((packed >>> 8) & 0xFF) / 255,
    a: (packed & 0xFF) / 255,
    packed,
  }
}

/**
 * Парсит nova color packed.
 */
export function parseNovaColorPacked(input: string | undefined, fallback = 0x00000000): number {
  if (!input) {
    return fallback >>> 0
  }

  const color = input.trim().toLowerCase()
  if (color in NAMED_COLORS) {
    return NAMED_COLORS[color] >>> 0
  }
  if (color.startsWith('#')) {
    return parseHexColor(color, fallback)
  }
  if (color.startsWith('rgb(') || color.startsWith('rgba(')) {
    return parseRgbColor(color, fallback)
  }

  return fallback >>> 0
}

/**
 * Парсит hex color.
 */
function parseHexColor(color: string, fallback: number): number {
  const hex = color.slice(1)

  if (hex.length === 3 || hex.length === 4) {
    const r = Number.parseInt(hex[0] + hex[0], 16)
    const g = Number.parseInt(hex[1] + hex[1], 16)
    const b = Number.parseInt(hex[2] + hex[2], 16)
    const a = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) : 255
    return packRgba(r, g, b, a)
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255
    if ([r, g, b, a].some(Number.isNaN)) {
      return fallback >>> 0
    }
    return packRgba(r, g, b, a)
  }

  return fallback >>> 0
}

/**
 * Парсит rgb color.
 */
function parseRgbColor(color: string, fallback: number): number {
  const start = color.indexOf('(')
  const end = color.lastIndexOf(')')
  if (start < 0 || end < start) {
    return fallback >>> 0
  }

  const parts = color.slice(start + 1, end).split(',').map(part => part.trim())
  if (parts.length < 3) {
    return fallback >>> 0
  }

  const r = parseChannel(parts[0])
  const g = parseChannel(parts[1])
  const b = parseChannel(parts[2])
  const a = parts[3] === undefined ? 255 : parseAlpha(parts[3])

  if ([r, g, b, a].some(Number.isNaN)) {
    return fallback >>> 0
  }
  return packRgba(r, g, b, a)
}

/**
 * Парсит channel.
 */
function parseChannel(value: string): number {
  if (value.endsWith('%')) {
    return clampByte((Number.parseFloat(value) / 100) * 255)
  }
  return clampByte(Number.parseFloat(value))
}

/**
 * Парсит alpha.
 */
function parseAlpha(value: string): number {
  if (value.endsWith('%')) {
    return clampByte((Number.parseFloat(value) / 100) * 255)
  }
  return clampByte(Number.parseFloat(value) * 255)
}

/**
 * Выполняет внутреннюю операцию clamp byte.
 */
function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * Выполняет внутреннюю операцию pack rgba.
 */
function packRgba(r: number, g: number, b: number, a: number): number {
  return (((r & 0xFF) << 24) | ((g & 0xFF) << 16) | ((b & 0xFF) << 8) | (a & 0xFF)) >>> 0
}

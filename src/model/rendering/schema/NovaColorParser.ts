const NAMED_COLORS: Record<string, number> = {
  black: 0x000000ff,
  white: 0xffffffff,
  red: 0xff0000ff,
  green: 0x008000ff,
  blue: 0x0000ffff,
  transparent: 0x00000000,
}

export interface NovaParsedColor {
  r: number
  g: number
  b: number
  a: number
  packed: number
}

export function parseNovaColor(input: string | undefined, fallback = 0x00000000): NovaParsedColor {
  const packed = parseNovaColorPacked(input, fallback)
  return {
    r: ((packed >>> 24) & 0xff) / 255,
    g: ((packed >>> 16) & 0xff) / 255,
    b: ((packed >>> 8) & 0xff) / 255,
    a: (packed & 0xff) / 255,
    packed,
  }
}

export function parseNovaColorPacked(input: string | undefined, fallback = 0x00000000): number {
  if (!input) return fallback >>> 0

  const color = input.trim().toLowerCase()
  if (color in NAMED_COLORS) return NAMED_COLORS[color] >>> 0
  if (color.startsWith('#')) return parseHexColor(color, fallback)
  if (color.startsWith('rgb(') || color.startsWith('rgba(')) return parseRgbColor(color, fallback)

  return fallback >>> 0
}

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
    if ([r, g, b, a].some(Number.isNaN)) return fallback >>> 0
    return packRgba(r, g, b, a)
  }

  return fallback >>> 0
}

function parseRgbColor(color: string, fallback: number): number {
  const start = color.indexOf('(')
  const end = color.lastIndexOf(')')
  if (start < 0 || end < start) return fallback >>> 0

  const parts = color.slice(start + 1, end).split(',').map(part => part.trim())
  if (parts.length < 3) return fallback >>> 0

  const r = parseChannel(parts[0])
  const g = parseChannel(parts[1])
  const b = parseChannel(parts[2])
  const a = parts[3] === undefined ? 255 : parseAlpha(parts[3])

  if ([r, g, b, a].some(Number.isNaN)) return fallback >>> 0
  return packRgba(r, g, b, a)
}

function parseChannel(value: string): number {
  if (value.endsWith('%')) return clampByte((Number.parseFloat(value) / 100) * 255)
  return clampByte(Number.parseFloat(value))
}

function parseAlpha(value: string): number {
  if (value.endsWith('%')) return clampByte((Number.parseFloat(value) / 100) * 255)
  return clampByte(Number.parseFloat(value) * 255)
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function packRgba(r: number, g: number, b: number, a: number): number {
  return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0
}

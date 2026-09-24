import type { NovaIcon, NovaIconRenderQualityOptions, NovaIconRenderQualityPreset } from '@/domain/types/renderer.types'

export interface NovaResolvedIconRenderRect {
  x: number
  y: number
  width: number
  height: number
}

export function resolveNovaIconRenderRect(icon: NovaIcon, dpr: number): NovaResolvedIconRenderRect {
  const quality = normalizeNovaIconQuality(icon.styles?.quality)
  if (quality.mode === 'auto') {
    return { x: icon.x, y: icon.y, width: icon.width, height: icon.height }
  }

  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const dpr1 = pixelRatio <= 1.25
  const snap = quality.snapToPixel ?? dpr1
  const minSize = dpr1 ? quality.minDpr1Size ?? (quality.mode === 'readable-dense' ? 18 : 0) : 0
  const scaleBoost = dpr1 ? quality.dpr1ScaleBoost ?? (quality.mode === 'readable-dense' ? 1.08 : 1) : 1
  const maxScaleBoost = Math.max(1, quality.maxScaleBoost ?? 1.28)
  const minDimension = Math.max(1, Math.min(icon.width, icon.height))
  const minFactor = minSize > 0 ? Math.min(maxScaleBoost, minSize / minDimension) : 1
  const factor = Math.min(maxScaleBoost, Math.max(1, minFactor, scaleBoost))
  const width = icon.width * factor
  const height = icon.height * factor
  const centerX = icon.x + icon.width / 2
  const centerY = icon.y + icon.height / 2
  const x = centerX - width / 2
  const y = centerY - height / 2

  if (!snap) {
    return { x, y, width, height }
  }

  return {
    x: snapToDevicePixel(x, pixelRatio),
    y: snapToDevicePixel(y, pixelRatio),
    width: Math.max(1 / pixelRatio, snapToDevicePixel(width, pixelRatio)),
    height: Math.max(1 / pixelRatio, snapToDevicePixel(height, pixelRatio)),
  }
}

function normalizeNovaIconQuality(
  quality: NovaIconRenderQualityPreset | NovaIconRenderQualityOptions | undefined,
): Required<Pick<NovaIconRenderQualityOptions, 'mode'>> & NovaIconRenderQualityOptions {
  if (!quality) {
    return { mode: 'auto' }
  }
  if (typeof quality === 'string') {
    return { mode: quality as NovaIconRenderQualityPreset }
  }
  return { mode: quality.mode ?? 'auto', ...quality }
}

function snapToDevicePixel(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr
}

export function resolveNovaIconRenderOpacity(icon: NovaIcon, dpr: number): number {
  const opacity = icon.styles?.opacity ?? 1
  const quality = normalizeNovaIconQuality(icon.styles?.quality)
  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  if (quality.mode === 'auto' || pixelRatio > 1.25) {
    return opacity
  }

  const boost = quality.dpr1OpacityBoost ?? (quality.mode === 'readable-dense' ? 1.18 : 1)
  const max = quality.maxOpacity ?? 1
  return Math.max(0, Math.min(max, opacity * boost))
}
